using Marketplace.Application.Exceptions;
using Marketplace.Application.DTOs.Reviews;
using Marketplace.Application.Interfaces;
using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;

namespace Marketplace.Application.Services;

public class ReviewService : IReviewService
{
    private readonly IUnitOfWork _uow;

    public ReviewService(IUnitOfWork uow)
    {
        _uow = uow;
    }

    public async Task<CanReviewResponse> CanUserReviewProductAsync(int buyerId, int productId)
    {
        var product = await _uow.Products.GetByIdAsync(productId);
        if (product == null)
        {
            return new CanReviewResponse
            {
                CanReview = false,
                Reason = "المنتج غير موجود."
            };
        }

        // Check if buyer has any delivered shipment containing this product
        var buyerOrders = (await _uow.Orders.FindAsync(o => o.BuyerId == buyerId)).Select(o => o.Id).ToList();
        if (!buyerOrders.Any())
        {
            return new CanReviewResponse
            {
                CanReview = false,
                Reason = "لا يمكنك تقييم المنتج إلا بعد شرائه واستلام الشحنة بنجاح."
            };
        }

        var deliveredShipments = (await _uow.Shipments.FindAsync(s => 
            buyerOrders.Contains(s.OrderId) && s.Status == ShipmentStatus.Delivered)).Select(s => s.Id).ToList();

        if (!deliveredShipments.Any())
        {
            return new CanReviewResponse
            {
                CanReview = false,
                Reason = "لا يمكنك تقييم المنتج إلا بعد استلام الشحنة وتأكيد التسليم بنجاح."
            };
        }

        var hasDeliveredItem = (await _uow.OrderItems.FindAsync(i => 
            i.ProductId == productId && deliveredShipments.Contains(i.ShipmentId))).Any();

        if (!hasDeliveredItem)
        {
            return new CanReviewResponse
            {
                CanReview = false,
                Reason = "لم يتم استلام هذا المنتج في أي طلب مكتمل حتى الآن."
            };
        }

        var existingReview = (await _uow.Reviews.FindAsync(r => r.ProductId == productId && r.BuyerId == buyerId)).FirstOrDefault();

        return new CanReviewResponse
        {
            CanReview = true,
            AlreadyReviewed = existingReview != null,
            Reason = existingReview != null ? "قمت بتقييم هذا المنتج مسبقاً، يمكنك تعديل تقييمك." : null
        };
    }

    public async Task<ReviewResponse> AddReviewAsync(int buyerId, CreateReviewRequest request)
    {
        var eligibility = await CanUserReviewProductAsync(buyerId, request.ProductId);
        if (!eligibility.CanReview)
        {
            throw new BadRequestException(eligibility.Reason ?? "غير مصرح لك بتقييم هذا المنتج.");
        }

        var product = await _uow.Products.GetByIdAsync(request.ProductId);
        if (product == null)
            throw new NotFoundException("المنتج غير موجود.");

        var buyer = await _uow.Users.GetByIdAsync(buyerId);
        if (buyer == null)
            throw new NotFoundException("المستخدم غير موجود.");

        var existingReview = (await _uow.Reviews.FindAsync(r => r.ProductId == request.ProductId && r.BuyerId == buyerId)).FirstOrDefault();

        Review review;
        if (existingReview != null)
        {
            existingReview.Rating = request.Rating;
            existingReview.Comment = request.Comment?.Trim() ?? string.Empty;
            existingReview.UpdatedAt = DateTime.UtcNow;
            _uow.Reviews.Update(existingReview);
            review = existingReview;
        }
        else
        {
            review = new Review
            {
                ProductId = request.ProductId,
                BuyerId = buyerId,
                Rating = request.Rating,
                Comment = request.Comment?.Trim() ?? string.Empty,
                CreatedAt = DateTime.UtcNow
            };
            await _uow.Reviews.AddAsync(review);
        }

        await _uow.SaveChangesAsync();

        // Recalculate Product rating aggregate
        var allProductReviews = (await _uow.Reviews.FindAsync(r => r.ProductId == request.ProductId)).ToList();
        var totalReviews = allProductReviews.Count;
        var avg = totalReviews > 0 ? allProductReviews.Average(r => r.Rating) : 0;

        product.AverageRating = Math.Round((decimal)avg, 2);
        product.ReviewsCount = totalReviews;
        _uow.Products.Update(product);

        await _uow.SaveChangesAsync();

        return new ReviewResponse
        {
            Id = review.Id,
            ProductId = review.ProductId,
            BuyerId = review.BuyerId,
            BuyerName = buyer.Name,
            Rating = review.Rating,
            Comment = review.Comment,
            CreatedAt = review.CreatedAt
        };
    }

    public async Task<ProductReviewsSummaryResponse> GetProductReviewsAsync(int productId, int page = 1, int pageSize = 10)
    {
        var product = await _uow.Products.GetByIdAsync(productId);
        if (product == null)
            throw new NotFoundException("المنتج غير موجود.");

        var allReviews = (await _uow.Reviews.FindAsync(r => r.ProductId == productId)).ToList();
        var totalReviews = allReviews.Count;
        var avg = totalReviews > 0 ? (decimal)Math.Round(allReviews.Average(r => r.Rating), 2) : 0m;

        var starDist = new Dictionary<int, int>
        {
            { 1, 0 }, { 2, 0 }, { 3, 0 }, { 4, 0 }, { 5, 0 }
        };
        foreach (var r in allReviews)
        {
            if (starDist.ContainsKey(r.Rating))
                starDist[r.Rating]++;
        }

        var pagedReviews = allReviews
            .OrderByDescending(r => r.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(pageSize, 1, 50))
            .Take(Math.Clamp(pageSize, 1, 50))
            .ToList();

        var buyerIds = pagedReviews.Select(r => r.BuyerId).Distinct().ToList();
        var buyers = (await _uow.Users.FindAsync(u => buyerIds.Contains(u.Id)))
            .ToDictionary(
                u => u.Id,
                u => (!u.IsActive || string.IsNullOrWhiteSpace(u.Name)) ? "مشتري" : u.Name);

        var reviewResponses = pagedReviews.Select(r => new ReviewResponse
        {
            Id = r.Id,
            ProductId = r.ProductId,
            BuyerId = r.BuyerId,
            BuyerName = buyers.GetValueOrDefault(r.BuyerId, "مشتري"),
            Rating = r.Rating,
            Comment = r.Comment,
            CreatedAt = r.CreatedAt
        }).ToList();

        return new ProductReviewsSummaryResponse
        {
            ProductId = productId,
            AverageRating = avg,
            TotalReviews = totalReviews,
            StarDistribution = starDist,
            Reviews = reviewResponses
        };
    }
}
