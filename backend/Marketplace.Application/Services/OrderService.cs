using Marketplace.Application.DTOs.Delivery;
using Marketplace.Application.DTOs.Orders;
using Marketplace.Application.DTOs.Shipments;
using Marketplace.Application.Exceptions;
using Marketplace.Application.Interfaces;
using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;
using Marketplace.Application.Common;
using Microsoft.Extensions.Configuration;

namespace Marketplace.Application.Services;

public class OrderService : IOrderService
{
    private readonly IUnitOfWork _uow;
    private readonly IDeliveryProvider _deliveryProvider;
    private readonly IConfiguration _configuration;
    private readonly INotificationService _notificationService;

    public OrderService(
        IUnitOfWork uow,
        IDeliveryProvider deliveryProvider,
        IConfiguration configuration,
        INotificationService notificationService)
    {
        _uow = uow;
        _deliveryProvider = deliveryProvider;
        _configuration = configuration;
        _notificationService = notificationService;
    }

    public async Task<OrderResponse> CreateOrderAsync(int buyerId, CreateOrderRequest request)
    {
        if (request.Items == null || !request.Items.Any())
            throw new BadRequestException("Order must contain at least one item.");

        var buyer = await _uow.Users.GetByIdAsync(buyerId);
        if (buyer == null || (buyer.Email != null && buyer.Email.StartsWith("deleted_", StringComparison.OrdinalIgnoreCase)))
            throw new UnauthorizedException("الحساب غير موجود أو تم حذفه.");

        var requireVerification = _configuration.GetValue<bool>("Auth:RequireVerification", true);
        if (requireVerification && buyer.EmailVerifiedAt == null && buyer.PhoneVerifiedAt == null)
        {
            throw new ForbiddenException("يجب تأكيد البريد الإلكتروني أو رقم الهاتف لإتمام الطلب (User must have a verified email or phone to place orders).");
        }

        if (!Enum.TryParse<DeliveryMethod>(request.DeliveryMethod, true, out var deliveryMethod))
            throw new BadRequestException("DeliveryMethod must be 'Pickup' or 'Courier'.");

        if (!Enum.TryParse<PaymentMethod>(request.PaymentMethod, true, out var paymentMethod))
            throw new BadRequestException("PaymentMethod must be 'OnReceipt'.");

        var normalizedPhone = EgyptianPhoneNormalizer.Normalize(request.RecipientPhone);

        // Refusal threshold check for Cash on Delivery (COD) - both by buyerId and phone
        if (paymentMethod == PaymentMethod.OnReceipt)
        {
            int maxCodRefusals = _configuration.GetValue<int>("Orders:MaxCodRefusals", 3);
            var buyerShipments = await _uow.Shipments.FindAsync(s =>
                (s.Order.BuyerId == buyerId || s.Order.RecipientPhone == normalizedPhone) &&
                s.Status == ShipmentStatus.Returned &&
                s.ReturnReason == ReturnReason.RefusedByBuyer);

            int refusedCount = buyerShipments.Count();
            if (refusedCount >= maxCodRefusals)
            {
                throw new BadRequestException("تم إيقاف خيار الدفع عند الاستلام لحسابك نظراً لتجاوز الحد الأقصى المسموح به لمرات رفض استلام الشحنات السابقة.");
            }

            // DoS Prevention: Maximum concurrent active/pending orders per buyer / phone
            var activeOrders = await _uow.Orders.FindAsync(o =>
                (o.BuyerId == buyerId || o.RecipientPhone == normalizedPhone) &&
                o.Status != OrderStatus.Delivered &&
                o.Status != OrderStatus.Cancelled);

            if (activeOrders.Count() >= 10)
            {
                throw new BadRequestException("لقد وصلت إلى الحد الأقصى للطلبات النشطة قيد التنفيذ (10 طلبات). يرجى انتظار استلام طلباتك السابقة.");
            }
        }

        string destinationGovernorate;
        string destinationCity;
        string destinationArea;
        string destinationStreetBuilding;
        string? addressLine;
        string? pickupPointId = null;

        if (deliveryMethod == DeliveryMethod.Pickup)
        {
            if (string.IsNullOrWhiteSpace(request.PickupPointId))
                throw new BadRequestException("PickupPointId is required for Pickup delivery.");

            var point = await _deliveryProvider.GetPickupPointByIdAsync(request.PickupPointId.Trim());
            if (point == null)
                throw new BadRequestException("Invalid PickupPointId.");

            if (!string.IsNullOrWhiteSpace(request.City) &&
                !string.Equals(request.City.Trim(), point.City, StringComparison.OrdinalIgnoreCase))
            {
                throw new BadRequestException($"Pickup point '{point.Id}' belongs to city '{point.City}', not '{request.City}'.");
            }

            pickupPointId = point.Id;
            destinationCity = point.City;
            destinationGovernorate = string.IsNullOrWhiteSpace(request.Governorate) ? point.City : request.Governorate.Trim();
            destinationArea = "نقطة استلام";
            destinationStreetBuilding = point.Address;
            addressLine = point.Address;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(request.City))
                throw new BadRequestException("City is required for Courier delivery.");

            if (!await _deliveryProvider.IsValidCityAsync(request.City.Trim()))
                throw new BadRequestException("Selected City is not supported by the delivery provider.");

            destinationCity = request.City.Trim();
            destinationGovernorate = string.IsNullOrWhiteSpace(request.Governorate) ? destinationCity : request.Governorate.Trim();
            destinationArea = string.IsNullOrWhiteSpace(request.Area) ? "غير محدد" : request.Area.Trim();
            destinationStreetBuilding = string.IsNullOrWhiteSpace(request.StreetBuilding)
                ? (request.AddressLine?.Trim() ?? string.Empty)
                : request.StreetBuilding.Trim();

            if (string.IsNullOrWhiteSpace(destinationStreetBuilding))
                throw new BadRequestException("StreetBuilding or AddressLine is required for Courier delivery.");

            addressLine = $"{destinationArea}، {destinationStreetBuilding}".Trim();
        }

        // Group duplicate order items by (ProductId, VariantId)
        var consolidatedItems = request.Items
            .GroupBy(i => (i.ProductId, i.VariantId))
            .Select(g => new { g.Key.ProductId, g.Key.VariantId, Quantity = g.Sum(x => x.Quantity) })
            .ToList();

        var loadedItems = new List<(Product Product, ProductVariant? Variant, int Quantity, decimal UnitPrice, string? VariantSummary)>();

        await _uow.BeginTransactionAsync();
        try
        {
            foreach (var reqItem in consolidatedItems)
            {
                if (reqItem.Quantity <= 0)
                    throw new BadRequestException("يجب أن تكون كمية المنتج أكبر من الصفر.");

                var product = await _uow.Products.GetByIdAsync(reqItem.ProductId);
                if (product == null)
                    throw new NotFoundException($"Product with ID {reqItem.ProductId} not found.");

                // Self-dealing prevention
                if (product.SellerId == buyerId)
                {
                    throw new BadRequestException($"لا يمكنك شراء منتجك الخاص '{product.Name}'.");
                }

                ProductVariant? variant = null;
                decimal unitPrice = product.Price;
                string? variantSummary = null;

                if (reqItem.VariantId.HasValue)
                {
                    variant = await _uow.ProductVariants.GetByIdAsync(reqItem.VariantId.Value);
                    if (variant == null || variant.ProductId != product.Id)
                    {
                        throw new BadRequestException($"المتغير المطلوب غير موجود للمنتج '{product.Name}'.");
                    }

                    unitPrice = variant.PriceOverride ?? product.Price;

                    var parts = new List<string>();
                    if (!string.IsNullOrWhiteSpace(variant.Size)) parts.Add($"المقاس: {variant.Size}");
                    if (!string.IsNullOrWhiteSpace(variant.Color)) parts.Add($"اللون: {variant.Color}");
                    if (!string.IsNullOrWhiteSpace(variant.AttributeName) && !string.IsNullOrWhiteSpace(variant.AttributeValue))
                        parts.Add($"{variant.AttributeName}: {variant.AttributeValue}");
                    variantSummary = parts.Any() ? string.Join(" | ", parts) : null;

                    var affected = await _uow.ExecuteSqlRawAsync(
                        @"UPDATE ""ProductVariants"" SET ""Stock"" = ""Stock"" - {0} WHERE ""Id"" = {1} AND ""ProductId"" = {2} AND ""Stock"" >= {0}",
                        reqItem.Quantity,
                        variant.Id,
                        product.Id);

                    if (affected == 0)
                    {
                        throw new BadRequestException($"المخزون غير كافٍ للمنتج '{product.Name}' (المتغير: {variantSummary ?? variant.Sku ?? "المحدد"}).");
                    }
                }
                else
                {
                    var affected = await _uow.ExecuteSqlRawAsync(
                        @"UPDATE ""Products"" SET ""Stock"" = ""Stock"" - {0} WHERE ""Id"" = {1} AND ""Stock"" >= {0}",
                        reqItem.Quantity,
                        reqItem.ProductId);

                    if (affected == 0)
                    {
                        throw new BadRequestException($"المخزون غير كافٍ للمنتج '{product.Name}'. المتوفر أقل من الكمية المطلوبة.");
                    }
                }

                loadedItems.Add((product, variant, reqItem.Quantity, unitPrice, variantSummary));
            }

            var sellerIds = loadedItems.Select(x => x.Product.SellerId).Distinct().ToList();
            var sellers = (await _uow.Users.FindAsync(u => sellerIds.Contains(u.Id))).ToDictionary(u => u.Id, u => u.Name);
            var sellerProfiles = (await _uow.SellerProfiles.FindAsync(sp => sellerIds.Contains(sp.UserId)))
                .ToDictionary(sp => sp.UserId);

            var order = new Order
            {
                BuyerId = buyerId,
                DeliveryMethod = deliveryMethod,
                PickupPointId = pickupPointId,
                RecipientName = request.RecipientName.Trim(),
                RecipientPhone = normalizedPhone,
                Governorate = destinationGovernorate,
                City = destinationCity,
                Area = destinationArea,
                StreetBuilding = destinationStreetBuilding,
                PaymentMethod = paymentMethod,
                CreatedAt = DateTime.UtcNow,
                Shipments = new List<Shipment>(),
                Items = new List<OrderItem>()
            };

            decimal itemsSubtotal = 0m;
            decimal deliveryTotal = 0m;
            decimal freeShippingThreshold = _configuration.GetValue<decimal>("Orders:FreeShippingThreshold", 1000m);
            decimal overallOrderItemsSubtotal = loadedItems.Sum(x => x.UnitPrice * x.Quantity);

            // Group items by seller -> 1 Shipment per seller
            var sellerGroups = loadedItems.GroupBy(x => x.Product.SellerId);

            foreach (var group in sellerGroups)
            {
                int sellerId = group.Key;
                string dispatchCity = sellerProfiles.TryGetValue(sellerId, out var profile) && !string.IsNullOrWhiteSpace(profile.DispatchCity)
                    ? profile.DispatchCity
                    : "القاهرة";

                int parcelWeightGrams = group.Sum(x => Math.Max(1, x.Product.WeightGrams) * x.Quantity);
                decimal parcelItemsSubtotal = group.Sum(x => x.UnitPrice * x.Quantity);

                var carrierShipment = await _deliveryProvider.CreateShipmentAsync(new CreateCarrierShipmentRequest
                {
                    SellerId = sellerId,
                    FromCity = dispatchCity,
                    ToCity = destinationCity,
                    DeliveryMethod = deliveryMethod,
                    PickupPointId = pickupPointId,
                    TotalWeightGrams = parcelWeightGrams
                });

                decimal deliveryCost = carrierShipment.DeliveryCost;
                if (parcelItemsSubtotal >= freeShippingThreshold || overallOrderItemsSubtotal >= freeShippingThreshold)
                {
                    deliveryCost = 0m;
                }

                decimal shipmentCodAmount = paymentMethod == PaymentMethod.OnReceipt
                    ? parcelItemsSubtotal + deliveryCost
                    : 0m;

                var shipment = new Shipment
                {
                    Order = order,
                    SellerId = sellerId,
                    Status = carrierShipment.Status,
                    TrackingNumber = carrierShipment.TrackingNumber,
                    DeliveryCost = deliveryCost,
                    CodAmount = shipmentCodAmount,
                    EtaMinDays = carrierShipment.EtaMinDays,
                    EtaMaxDays = carrierShipment.EtaMaxDays,
                    CreatedAt = DateTime.UtcNow,
                    Items = new List<OrderItem>()
                };

                foreach (var (product, variant, quantity, unitPrice, variantSummary) in group)
                {
                    var orderItem = new OrderItem
                    {
                        Order = order,
                        Shipment = shipment,
                        ProductId = product.Id,
                        VariantId = variant?.Id,
                        VariantSummary = variantSummary,
                        Quantity = quantity,
                        UnitPrice = unitPrice
                    };

                    itemsSubtotal += orderItem.UnitPrice * orderItem.Quantity;
                    shipment.Items.Add(orderItem);
                    order.Items.Add(orderItem);
                }

                deliveryTotal += shipment.DeliveryCost;
                order.Shipments.Add(shipment);
            }

            // Coupon Processing
            decimal totalDiscount = 0m;
            Coupon? coupon = null;

            if (!string.IsNullOrWhiteSpace(request.CouponCode))
            {
                var code = request.CouponCode.Trim().ToUpperInvariant();
                coupon = (await _uow.Coupons.FindAsync(c => c.Code == code)).FirstOrDefault();
                if (coupon == null || !coupon.IsActive || coupon.ExpiresAt < DateTime.UtcNow)
                {
                    throw new BadRequestException("كوبون الخصم غير صالح أو منتهي الصلاحية.");
                }

                if (coupon.UsedCount >= coupon.MaxUsage)
                {
                    throw new BadRequestException("تم استنفاد الحد الأقصى لاستخدام هذا الكوبون.");
                }

                var userUsageCount = (await _uow.CouponUsages.FindAsync(u => u.CouponId == coupon.Id && u.BuyerId == buyerId)).Count();
                if (userUsageCount >= coupon.PerUserLimit)
                {
                    throw new BadRequestException("لقد استخدمت هذا الكوبون الحد الأقصى المسموح به.");
                }

                var applicableItems = loadedItems.Where(x => !coupon.SellerId.HasValue || x.Product.SellerId == coupon.SellerId.Value).ToList();
                if (!applicableItems.Any())
                {
                    throw new BadRequestException("كوبون الخصم غير قابل للتطبيق على أي من منتجات هذا الطلب.");
                }

                decimal applicableSubtotal = applicableItems.Sum(x => x.UnitPrice * x.Quantity);
                if (applicableSubtotal < coupon.MinOrderSubtotal)
                {
                    throw new BadRequestException($"الحد الأدنى لتطبيق هذا الكوبون هو {coupon.MinOrderSubtotal} ج.م.");
                }

                // Atomic update to avoid race conditions
                var couponAffected = await _uow.ExecuteSqlRawAsync(
                    @"UPDATE ""Coupons"" SET ""UsedCount"" = ""UsedCount"" + 1 WHERE ""Id"" = {0} AND ""IsActive"" = TRUE AND ""UsedCount"" < ""MaxUsage""",
                    coupon.Id);

                if (couponAffected == 0)
                {
                    throw new BadRequestException("كوبون الخصم غير صالح أو تم استنفاد الحد الأقصى لاستخدامه.");
                }

                if (coupon.DiscountType == DiscountType.Percentage)
                {
                    totalDiscount = applicableSubtotal * (coupon.DiscountValue / 100m);
                    if (coupon.MaxDiscountAmount.HasValue && totalDiscount > coupon.MaxDiscountAmount.Value)
                    {
                        totalDiscount = coupon.MaxDiscountAmount.Value;
                    }
                }
                else
                {
                    totalDiscount = Math.Min(coupon.DiscountValue, applicableSubtotal);
                }

                totalDiscount = Math.Round(totalDiscount, 2);
                order.DiscountAmount = totalDiscount;
                order.CouponCode = coupon.Code;

                if (totalDiscount > 0)
                {
                    decimal remainingDiscount = totalDiscount;
                    var applicableShipments = order.Shipments
                        .Where(s => !coupon.SellerId.HasValue || s.SellerId == coupon.SellerId.Value)
                        .ToList();

                    decimal totalCod = applicableShipments.Sum(s => s.CodAmount);

                    for (int i = 0; i < applicableShipments.Count; i++)
                    {
                        var s = applicableShipments[i];
                        decimal deduct = (i == applicableShipments.Count - 1 || totalCod == 0)
                            ? remainingDiscount
                            : Math.Round(totalDiscount * (s.CodAmount / totalCod), 2);

                        deduct = Math.Min(deduct, s.CodAmount);
                        s.CodAmount = Math.Max(0m, s.CodAmount - deduct);
                        remainingDiscount -= deduct;
                    }

                    var couponUsage = new CouponUsage
                    {
                        CouponId = coupon.Id,
                        BuyerId = buyerId,
                        Order = order,
                        DiscountApplied = totalDiscount,
                        UsedAt = DateTime.UtcNow
                    };
                    await _uow.CouponUsages.AddAsync(couponUsage);
                }
            }

            // Buyer Wallet Processing
            decimal walletUsed = 0m;
            if (request.UseWalletBalance)
            {
                var wallet = (await _uow.BuyerWallets.FindAsync(w => w.BuyerId == buyerId)).FirstOrDefault();
                if (wallet != null && wallet.Balance > 0)
                {
                    decimal payableCodTotal = order.Shipments.Sum(s => s.CodAmount);
                    walletUsed = Math.Min(wallet.Balance, payableCodTotal);

                    if (walletUsed > 0)
                    {
                        var walletAffected = await _uow.ExecuteSqlRawAsync(
                            @"UPDATE ""BuyerWallets"" SET ""Balance"" = ""Balance"" - {0}, ""UpdatedAt"" = {1} WHERE ""BuyerId"" = {2} AND ""Balance"" >= {0}",
                            walletUsed,
                            DateTime.UtcNow,
                            buyerId);

                        if (walletAffected == 0)
                        {
                            throw new BadRequestException("حدث تعارض أثناء خصم رصيد المحفظة أو الرصيد غير كافٍ.");
                        }

                        var walletTx = new BuyerWalletTransaction
                        {
                            BuyerId = buyerId,
                            Order = order,
                            Amount = -walletUsed,
                            Type = BuyerWalletTransactionType.OrderRedemption,
                            Description = $"استخدام الرصيد في الطلب",
                            CreatedAt = DateTime.UtcNow
                        };
                        await _uow.BuyerWalletTransactions.AddAsync(walletTx);

                        order.WalletAmountUsed = walletUsed;

                        decimal remainingWallet = walletUsed;
                        foreach (var s in order.Shipments)
                        {
                            if (remainingWallet <= 0) break;
                            decimal sDeduct = Math.Min(s.CodAmount, remainingWallet);
                            s.CodAmount = Math.Max(0m, s.CodAmount - sDeduct);
                            remainingWallet -= sDeduct;
                        }
                    }
                }
            }

            // Authoritative total
            order.TotalAmount = Math.Max(0m, itemsSubtotal + deliveryTotal - order.DiscountAmount);
            order.Status = Order.DeriveStatus(order.Shipments.Select(s => s.Status));

            await _uow.Orders.AddAsync(order);
            await _uow.SaveChangesAsync();

            await _uow.CommitTransactionAsync();

            await _notificationService.NotifyOrderPlacedAsync(order.Id);

            var productLookup = loadedItems
                .GroupBy(x => x.Product.Id)
                .ToDictionary(g => g.Key, g => g.First().Product);

            return MapOrderToResponse(order, order.Shipments.ToList(), order.Items.ToList(), productLookup, sellers);
        }
        catch
        {
            await _uow.RollbackTransactionAsync();
            throw;
        }
    }

    public async Task<IEnumerable<OrderResponse>> GetBuyerOrdersAsync(int buyerId)
    {
        var buyer = await _uow.Users.GetByIdAsync(buyerId);
        if (buyer == null || (buyer.Email != null && buyer.Email.StartsWith("deleted_", StringComparison.OrdinalIgnoreCase)))
            throw new UnauthorizedException("الحساب غير موجود أو تم حذفه.");

        var orders = (await _uow.Orders.FindAsync(o => o.BuyerId == buyerId))
            .OrderByDescending(o => o.CreatedAt)
            .ToList();

        if (!orders.Any())
            return Enumerable.Empty<OrderResponse>();

        var orderIds = orders.Select(o => o.Id).ToList();
        var allShipments = (await _uow.Shipments.FindAsync(s => orderIds.Contains(s.OrderId))).ToList();
        var allItems = (await _uow.OrderItems.FindAsync(i => orderIds.Contains(i.OrderId))).ToList();

        var productIds = allItems.Select(i => i.ProductId).Distinct().ToList();
        var products = (await _uow.Products.FindAsync(p => productIds.Contains(p.Id))).ToDictionary(p => p.Id);

        var sellerIds = allShipments.Select(s => s.SellerId).Distinct().ToList();
        var sellers = (await _uow.Users.FindAsync(u => sellerIds.Contains(u.Id))).ToDictionary(u => u.Id, u => u.Name);

        var response = new List<OrderResponse>();
        foreach (var order in orders)
        {
            var shipments = allShipments.Where(s => s.OrderId == order.Id).ToList();
            var items = allItems.Where(i => i.OrderId == order.Id).ToList();
            response.Add(MapOrderToResponse(order, shipments, items, products, sellers));
        }

        return response;
    }

    public async Task<OrderResponse> GetOrderByIdAsync(int userId, int orderId)
    {
        var order = await _uow.Orders.GetByIdAsync(orderId);
        if (order == null)
            throw new NotFoundException($"Order with ID {orderId} not found.");

        var shipments = (await _uow.Shipments.FindAsync(s => s.OrderId == orderId)).ToList();
        bool isBuyer = order.BuyerId == userId;
        bool isSeller = shipments.Any(s => s.SellerId == userId);

        if (!isBuyer && !isSeller)
            throw new ForbiddenException("You do not have permission to view this order.");

        var items = (await _uow.OrderItems.FindAsync(i => i.OrderId == orderId)).ToList();
        var productIds = items.Select(i => i.ProductId).Distinct().ToList();
        var products = (await _uow.Products.FindAsync(p => productIds.Contains(p.Id))).ToDictionary(p => p.Id);

        if (!isBuyer && isSeller)
        {
            shipments = shipments.Where(s => s.SellerId == userId).ToList();
            var sellerProductIds = products.Values.Where(p => p.SellerId == userId).Select(p => p.Id).ToHashSet();
            items = items.Where(i => sellerProductIds.Contains(i.ProductId)).ToList();
        }

        var sellerIds = shipments.Select(s => s.SellerId).Distinct().ToList();
        var sellers = (await _uow.Users.FindAsync(u => sellerIds.Contains(u.Id))).ToDictionary(u => u.Id, u => u.Name);

        var mapped = MapOrderToResponse(order, shipments, items, products, sellers);

        if (!isBuyer && isSeller)
        {
            mapped.TotalAmount = mapped.ItemsSubtotal + mapped.DeliveryCost;
        }

        return mapped;
    }

    public async Task<IEnumerable<SellerOrderResponse>> GetSellerOrdersAsync(int sellerId)
    {
        var shipments = (await _uow.Shipments.FindAsync(s => s.SellerId == sellerId)).ToList();
        if (!shipments.Any())
            return Enumerable.Empty<SellerOrderResponse>();

        var shipmentIds = shipments.Select(s => s.Id).ToList();
        var orderIds = shipments.Select(s => s.OrderId).Distinct().ToList();

        var orders = (await _uow.Orders.FindAsync(o => orderIds.Contains(o.Id))).ToDictionary(o => o.Id);
        var buyerIds = orders.Values.Select(o => o.BuyerId).Distinct().ToList();
        var buyers = (await _uow.Users.FindAsync(u => buyerIds.Contains(u.Id))).ToDictionary(u => u.Id, u => u.Name);

        var items = (await _uow.OrderItems.FindAsync(i => shipmentIds.Contains(i.ShipmentId))).ToList();
        var productIds = items.Select(i => i.ProductId).Distinct().ToList();
        var products = (await _uow.Products.FindAsync(p => productIds.Contains(p.Id))).ToDictionary(p => p.Id);

        var response = new List<SellerOrderResponse>();
        foreach (var item in items)
        {
            if (!orders.TryGetValue(item.OrderId, out var order))
                continue;

            products.TryGetValue(item.ProductId, out var product);
            buyers.TryGetValue(order.BuyerId, out var buyerName);

            response.Add(new SellerOrderResponse
            {
                OrderId = order.Id,
                BuyerName = ExtractFirstName(order.RecipientName.Length > 0 ? order.RecipientName : buyerName),
                ProductName = product?.Name ?? "Unknown Product",
                VariantId = item.VariantId,
                VariantSummary = item.VariantSummary,
                Quantity = item.Quantity,
                TotalPrice = item.UnitPrice * item.Quantity,
                Status = order.Status.ToString(),
                Date = order.CreatedAt
            });
        }

        return response.OrderByDescending(r => r.Date);
    }

    public async Task UpdateOrderStatusAsync(int sellerId, int orderId, string status)
    {
        var order = await _uow.Orders.GetByIdAsync(orderId);
        if (order == null)
            throw new NotFoundException($"Order with ID {orderId} not found.");

        var shipments = (await _uow.Shipments.FindAsync(s => s.OrderId == orderId && s.SellerId == sellerId)).ToList();
        if (!shipments.Any())
            throw new ForbiddenException("You do not have permission to update this order.");

        if (!Enum.TryParse<OrderStatus>(status, true, out var newStatus))
            throw new BadRequestException($"Invalid status: {status}");

        var allShipments = (await _uow.Shipments.FindAsync(s => s.OrderId == orderId)).ToList();
        if (allShipments.Count <= 1)
        {
            order.Status = newStatus;
        }
        else
        {
            order.Status = Order.DeriveStatus(allShipments.Select(s => s.Status));
        }

        _uow.Orders.Update(order);
        await _uow.SaveChangesAsync();
    }

    private static OrderResponse MapOrderToResponse(
        Order order,
        List<Shipment> shipments,
        List<OrderItem> items,
        Dictionary<int, Product> products,
        Dictionary<int, string> sellers)
    {
        decimal itemsSubtotal = items.Sum(i => i.UnitPrice * i.Quantity);
        decimal deliveryCost = shipments.Sum(s => s.DeliveryCost);

        var shipmentResponses = shipments.Select(s =>
        {
            var shipmentItems = items
                .Where(i => i.ShipmentId == s.Id || (i.ShipmentId == 0 && products.TryGetValue(i.ProductId, out var p) && p.SellerId == s.SellerId))
                .Select(i => new OrderItemResponse
                {
                    Id = i.Id,
                    ProductId = i.ProductId,
                    ProductName = products.TryGetValue(i.ProductId, out var prod) ? prod.Name : "Unknown",
                    VariantId = i.VariantId,
                    VariantSummary = i.VariantSummary,
                    Quantity = i.Quantity,
                    UnitPrice = i.UnitPrice,
                    WeightGrams = products.TryGetValue(i.ProductId, out var prodW) ? prodW.WeightGrams : 500
                })
                .ToList();

            return new BuyerShipmentResponse
            {
                Id = s.Id,
                OrderId = order.Id,
                SellerId = s.SellerId,
                SellerName = sellers.GetValueOrDefault(s.SellerId, "Unknown"),
                Status = s.Status.ToString(),
                TrackingNumber = s.TrackingNumber,
                DeliveryCost = s.DeliveryCost,
                CodAmount = s.CodAmount,
                ReturnReason = s.ReturnReason?.ToString(),
                EtaMinDays = s.EtaMinDays,
                EtaMaxDays = s.EtaMaxDays,
                CreatedAt = s.CreatedAt,
                Items = shipmentItems
            };
        }).ToList();

        var itemResponses = items.Select(i => new OrderItemResponse
        {
            Id = i.Id,
            ProductId = i.ProductId,
            ProductName = products.TryGetValue(i.ProductId, out var prod) ? prod.Name : "Unknown",
            VariantId = i.VariantId,
            VariantSummary = i.VariantSummary,
            Quantity = i.Quantity,
            UnitPrice = i.UnitPrice,
            WeightGrams = products.TryGetValue(i.ProductId, out var prodW) ? prodW.WeightGrams : 500
        }).ToList();

        string computedAddressLine = $"{order.Area}، {order.StreetBuilding}".Trim();

        return new OrderResponse
        {
            Id = order.Id,
            ItemsSubtotal = itemsSubtotal,
            DeliveryCost = deliveryCost,
            DiscountAmount = order.DiscountAmount,
            CouponCode = order.CouponCode,
            WalletAmountUsed = order.WalletAmountUsed,
            TotalAmount = order.TotalAmount,
            Status = order.Status.ToString(),
            DeliveryMethod = order.DeliveryMethod.ToString(),
            PickupPointId = order.PickupPointId,
            RecipientName = order.RecipientName,
            RecipientPhone = order.RecipientPhone,
            Governorate = order.Governorate,
            City = order.City,
            Area = order.Area,
            StreetBuilding = order.StreetBuilding,
            AddressLine = computedAddressLine,
            PaymentMethod = order.PaymentMethod.ToString(),
            CreatedAt = order.CreatedAt,
            Shipments = shipmentResponses,
            Items = itemResponses
        };
    }

    private static string ExtractFirstName(string? fullName)
    {
        if (string.IsNullOrWhiteSpace(fullName))
            return string.Empty;

        return fullName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;
    }
}
