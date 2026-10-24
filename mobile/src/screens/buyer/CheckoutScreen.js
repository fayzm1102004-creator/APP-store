import tw from 'twrnc';
import React, { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  I18nManager,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { CartContext } from '../../context/CartContext';
import { createOrder } from '../../api/ordersApi';
import { getProductById } from '../../api/productsApi';
import { getDeliveryCities, getPickupPoints, calculateDeliveryQuote } from '../../api/deliveryApi';
import { getMyAddresses, getMyWallet } from '../../api/usersApi';
import { getAppConfig } from '../../api/configApi';
import { validateCoupon } from '../../api/couponsApi';
import { formatCurrency } from '../../utils/currency';
import { isValidEgyptianPhone, normalizeEgyptianPhone, formatEgyptianPhone } from '../../utils/egyptianPhone';
import { getImageUrl } from '../../utils/imageUrl';
import { colors } from '../../theme/colors';
import { LinearGradient } from 'expo-linear-gradient';

const cardShadow = Platform.select({
  ios: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  android: {
    elevation: 1,
  },
  default: {},
});

export default function CheckoutScreen({ route, navigation }) {
  const { t, i18n } = useTranslation();
  const { removeItems, updateCartItem } = useContext(CartContext);
  const isRTL = i18n.language === 'ar';

  const buyNowItem = route?.params?.buyNowItem;
  const initialCartItems = route?.params?.cartItems;
  const isBuyNow = Boolean(buyNowItem);

  const [checkoutItems, setCheckoutItems] = useState(
    buyNowItem
      ? [
          {
            productId: buyNowItem.product.id,
            variantId: buyNowItem.selectedVariant?.id || null,
            selectedVariant: buyNowItem.selectedVariant || null,
            quantity: buyNowItem.quantity,
            product: buyNowItem.product,
          },
        ]
      : initialCartItems || []
  );

  // Delivery Method: 'Courier' or 'Pickup'
  const [deliveryMethod, setDeliveryMethod] = useState('Courier');

  // Coupon Engine State
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  // Buyer Wallet (Store Credit) State
  const [walletBalance, setWalletBalance] = useState(0);
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [walletEnabled, setWalletEnabled] = useState(false);
  const [couponsEnabled, setCouponsEnabled] = useState(false);

  // Saved addresses
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);

  // Manual Courier Address Fields
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [governorate, setGovernorate] = useState(isRTL ? 'القاهرة' : 'Cairo');
  const [city, setCity] = useState(isRTL ? 'مدينة نصر' : 'Nasr City');
  const [area, setArea] = useState(isRTL ? 'الحي السابع' : '7th District');
  const [streetBuilding, setStreetBuilding] = useState('');

  // Pickup Branch State
  const [availableCities, setAvailableCities] = useState([]);
  const [pickupCity, setPickupCity] = useState(isRTL ? 'القاهرة' : 'Cairo');
  const [pickupPoints, setPickupPoints] = useState([]);
  const [selectedPickupPointId, setSelectedPickupPointId] = useState('');

  // Delivery Quote State
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteData, setQuoteData] = useState(null);

  // Submission State
  const [submitting, setSubmitting] = useState(false);

  // Calculate items total
  const itemsSubtotal = useMemo(() => {
    return checkoutItems.reduce((acc, it) => {
      const price = it?.selectedVariant?.priceOverride != null
        ? Number(it.selectedVariant.priceOverride)
        : (Number(it?.product?.price) || 0);
      const qty = Number(it?.quantity) || 1;
      return acc + price * qty;
    }, 0);
  }, [checkoutItems]);

  const totalCount = useMemo(() => {
    return checkoutItems.reduce((acc, it) => acc + (Number(it?.quantity) || 1), 0);
  }, [checkoutItems]);

  // Load addresses, delivery cities, and buyer wallet on mount
  useEffect(() => {
    const initData = async () => {
      try {
        const addrRes = await getMyAddresses();
        if (Array.isArray(addrRes?.data) && addrRes.data.length > 0) {
          setSavedAddresses(addrRes.data);
          const def = addrRes.data.find((a) => a.isDefault) || addrRes.data[0];
          setSelectedAddressId(def.id);
          setRecipientName(def.recipientName || '');
          setRecipientPhone(def.recipientPhone || '');
          setGovernorate(def.governorate || (isRTL ? 'القاهرة' : 'Cairo'));
          setCity(def.city || (isRTL ? 'مدينة نصر' : 'Nasr City'));
          setArea(def.area || '');
          setStreetBuilding(def.streetBuilding || '');
        }
      } catch (e) {
        console.warn('Failed to load user addresses:', e);
      }

      try {
        const citiesRes = await getDeliveryCities();
        if (Array.isArray(citiesRes?.data) && citiesRes.data.length > 0) {
          setAvailableCities(citiesRes.data);
          const defaultCity = citiesRes.data[0].name;
          setPickupCity(defaultCity);
          loadPickupPoints(defaultCity);
        }
      } catch (e) {
        console.warn('Failed to load delivery cities:', e);
      }

      try {
        const configRes = await getAppConfig();
        if (configRes?.data) {
          setCouponsEnabled(Boolean(configRes.data.couponsEnabled));
          setWalletEnabled(Boolean(configRes.data.walletEnabled));
          if (configRes.data.walletEnabled) {
            setLoadingWallet(true);
            const walletRes = await getMyWallet();
            if (walletRes?.data?.balance != null) {
              setWalletBalance(Number(walletRes.data.balance));
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load config/wallet:', e);
      } finally {
        setLoadingWallet(false);
      }
    };

    initData();
  }, []);

  const loadPickupPoints = async (cityName) => {
    try {
      const res = await getPickupPoints(cityName);
      if (Array.isArray(res?.data)) {
        setPickupPoints(res.data);
        if (res.data.length > 0) {
          setSelectedPickupPointId(res.data[0].id);
        } else {
          setSelectedPickupPointId('');
        }
      }
    } catch (e) {
      console.warn('Failed to load pickup points:', e);
    }
  };

  // Fetch Delivery Quote whenever destination or items change
  const fetchQuote = useCallback(async () => {
    if (!checkoutItems || checkoutItems.length === 0) return;

    try {
      setQuoteLoading(true);
      const targetCity = deliveryMethod === 'Courier'
        ? (governorate || city || (isRTL ? 'القاهرة' : 'Cairo'))
        : (pickupCity || (isRTL ? 'القاهرة' : 'Cairo'));

      const payload = {
        items: checkoutItems.map((it) => ({
          productId: it.productId,
          variantId: it.variantId || it.selectedVariant?.id || null,
          quantity: it.quantity,
        })),
        deliveryMethod,
        city: targetCity,
        destinationCity: targetCity,
        pickupPointId: deliveryMethod === 'Pickup' && selectedPickupPointId ? selectedPickupPointId : null,
      };

      const res = await calculateDeliveryQuote(payload);
      if (res?.data) {
        setQuoteData(res.data);
      }
    } catch (e) {
      console.warn('Failed to calculate delivery quote:', e);
    } finally {
      setQuoteLoading(false);
    }
  }, [checkoutItems, deliveryMethod, governorate, city, pickupCity, selectedPickupPointId]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // Handle Coupon Validation
  const handleApplyCoupon = async () => {
    if (!couponCodeInput.trim() || validatingCoupon) return;
    try {
      setValidatingCoupon(true);
      const payload = {
        code: couponCodeInput.trim(),
        items: checkoutItems.map((it) => ({
          productId: it.productId,
          variantId: it.variantId || it.selectedVariant?.id || null,
          quantity: it.quantity,
        })),
      };
      const res = await validateCoupon(payload);
      if (res?.data?.isValid) {
        setAppliedCoupon(res.data);
        Alert.alert(
          isRTL ? 'تم تفعيل الكوبون' : 'Coupon Applied',
          res.data.message || (isRTL ? 'تم احتساب الخصم بنجاح!' : 'Discount applied successfully!')
        );
      } else {
        Alert.alert(
          isRTL ? 'كوبون غير صالح' : 'Invalid Coupon',
          res?.data?.message || (isRTL ? 'كود الكوبون غير صحيح أو غير مفعّل.' : 'Coupon code is invalid or expired.')
        );
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || (isRTL ? 'تعذر التحقق من الكوبون' : 'Failed to validate coupon');
      Alert.alert(isRTL ? 'خطأ بالكوبون' : 'Coupon Error', msg);
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCodeInput('');
  };

  // Handle Saved Address Selection
  const handleSelectSavedAddress = (addr) => {
    setSelectedAddressId(addr.id);
    setRecipientName(addr.recipientName || '');
    setRecipientPhone(addr.recipientPhone || '');
    setGovernorate(addr.governorate || '');
    setCity(addr.city || '');
    setArea(addr.area || '');
    setStreetBuilding(addr.streetBuilding || '');
  };

  const handleCityChangeForPickup = (newCity) => {
    setPickupCity(newCity);
    loadPickupPoints(newCity);
  };

  // Free shipping threshold calculations
  const freeShippingThreshold = quoteData?.freeShippingThreshold || 1000;
  const isFreeShipping = quoteData?.isFreeShippingApplied === true || itemsSubtotal >= freeShippingThreshold;
  const freeShippingProgress = Math.min(100, Math.round((itemsSubtotal / freeShippingThreshold) * 100));
  const neededForFreeShipping = Math.max(0, freeShippingThreshold - itemsSubtotal);

  // Price totals
  const couponDiscount = (couponsEnabled && appliedCoupon) ? Number(appliedCoupon.discountAmount) || 0 : 0;
  const deliveryCostTotal = Number(quoteData?.totalDeliveryCost) || (deliveryMethod === 'Pickup' ? 35 : 50);
  const subtotalAfterCoupon = Math.max(0, itemsSubtotal - couponDiscount);
  const totalBeforeWallet = subtotalAfterCoupon + deliveryCostTotal;
  const walletDeduction = (walletEnabled && useWalletBalance) ? Math.min(walletBalance, totalBeforeWallet) : 0;
  const grandTotal = Math.max(0, totalBeforeWallet - walletDeduction);

  const handleConfirmOrder = async () => {
    if (checkoutItems.length === 0 || submitting) return;

    // Validate inputs
    if (!recipientName.trim()) {
      Alert.alert(t('common.error'), isRTL ? 'يرجى إدخال اسم المستلم بالكامل' : 'Please enter full recipient name');
      return;
    }

    if (!isValidEgyptianPhone(recipientPhone)) {
      Alert.alert(t('common.error'), t('common.invalidPhone'));
      return;
    }

    if (deliveryMethod === 'Courier') {
      if (!governorate.trim() || !city.trim() || !area.trim() || !streetBuilding.trim()) {
        Alert.alert(
          t('common.error'),
          isRTL
            ? 'يرجى استكمال بيانات العنوان (المحافظة، المدينة، الحي، الشارع والعمارة)'
            : 'Please complete all address fields (governorate, city, area, street & building)'
        );
        return;
      }
    } else {
      if (!selectedPickupPointId) {
        Alert.alert(
          t('common.error'),
          isRTL ? 'يرجى اختيار فرع أو نقطة استلام بوسطة' : 'Please select a Bosta branch or pickup point'
        );
        return;
      }
    }

    setSubmitting(true);

    const payload = {
      items: checkoutItems.map((it) => ({
        productId: it.productId,
        variantId: it.variantId || it.selectedVariant?.id || null,
        quantity: it.quantity,
      })),
      deliveryMethod,
      pickupPointId: deliveryMethod === 'Pickup' ? selectedPickupPointId : null,
      recipientName: recipientName.trim(),
      recipientPhone: normalizeEgyptianPhone(recipientPhone),
      governorate: deliveryMethod === 'Courier' ? governorate.trim() : pickupCity,
      city: deliveryMethod === 'Courier' ? city.trim() : pickupCity,
      area: deliveryMethod === 'Courier' ? area.trim() : (isRTL ? 'نقطة استلام' : 'Pickup Point'),
      streetBuilding: deliveryMethod === 'Courier' ? streetBuilding.trim() : (isRTL ? 'استلام من الفرع' : 'Branch Pickup'),
      paymentMethod: 'CashOnDelivery',
      couponCode: (couponsEnabled && appliedCoupon?.code) ? appliedCoupon.code : null,
      useWalletBalance: walletEnabled ? useWalletBalance : false,
    };

    try {
      const res = await createOrder(payload);
      const createdOrder = res?.data;

      // Clean cart
      if (!isBuyNow) {
        const orderedIds = checkoutItems.map((it) => it.productId);
        removeItems(orderedIds);
      }

      Alert.alert(
        t('checkout.orderSuccessTitle'),
        t('checkout.orderSuccessMessage'),
        [
          {
            text: t('nav.orders'),
            onPress: () => {
              navigation.navigate('BuyerRoot', {
                screen: 'MyOrders',
                params: { refreshTimestamp: Date.now() },
              });
            },
          },
        ]
      );
    } catch (err) {
      console.error('Order creation failed', err);
      const serverMsg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        t('common.error');

      // Check if COD blocked
      if (err?.response?.status === 400 && serverMsg.includes('الدفع عند الاستلام')) {
        Alert.alert(
          isRTL ? 'تنبيه الدفع عند الاستلام' : 'Cash on Delivery Notice',
          t('checkout.codBlocked')
        );
      } else {
        Alert.alert(t('common.error'), serverMsg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checkoutItems.length === 0) {
    return (
      <View
        style={[
          tw`flex-1 items-center justify-center p-6`,
          { backgroundColor: colors.screenBg },
        ]}
      >
        <MaterialCommunityIcons name="cart-off" size={56} color={colors.textSecondary} />
        <Text style={[tw`text-lg font-bold mt-4 text-center`, { color: colors.textPrimary }]}>
          {t('cart.emptyTitle')}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[tw`mt-5 px-6 py-2.5 rounded-xl`, { backgroundColor: colors.primary }]}
        >
          <Text style={tw`text-white font-bold`}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[tw`flex-1`, { backgroundColor: colors.screenBg }]}>
      <ScrollView
        style={tw`flex-1`}
        contentContainerStyle={{ padding: 14, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Free Shipping Progress Bar */}
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            {
              backgroundColor: isFreeShipping ? '#F0FDF4' : colors.cardBg,
              borderColor: isFreeShipping ? colors.newBadge : colors.border,
            },
          ]}
        >
          <View style={tw`flex-row items-center justify-between mb-2`}>
            <View style={tw`flex-row items-center flex-1`}>
              <MaterialCommunityIcons
                name={isFreeShipping ? 'truck-check' : 'truck-fast-outline'}
                size={22}
                color={isFreeShipping ? colors.newBadge : colors.accent}
              />
              <Text
                style={[
                  tw`font-bold text-xs ${isRTL ? 'mr-2' : 'ml-2'} flex-1`,
                  { color: isFreeShipping ? colors.newBadge : colors.textPrimary },
                ]}
              >
                {isFreeShipping
                  ? t('checkout.freeShippingQualified')
                  : t('checkout.freeShippingAddMore', { amount: formatCurrency(neededForFreeShipping) })}
              </Text>
            </View>
            <Text style={[tw`font-bold text-xs`, { color: isFreeShipping ? colors.newBadge : colors.accent }]}>
              {freeShippingProgress}%
            </Text>
          </View>

          {/* Progress Bar Track */}
          <View style={[tw`w-full h-2 rounded-full overflow-hidden`, { backgroundColor: '#E2E8F0' }]}>
            <View
              style={{
                width: `${freeShippingProgress}%`,
                height: '100%',
                backgroundColor: isFreeShipping ? colors.newBadge : colors.accent,
                borderRadius: 999,
              }}
            />
          </View>
          <Text style={[tw`text-[10px] mt-1.5`, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
            {t('checkout.freeShippingMin', { amount: formatCurrency(freeShippingThreshold) })}
          </Text>
        </View>

        {/* 1. Egyptian COD Banner */}
        <View
          style={[
            tw`flex-row items-center p-3.5 rounded-xl mb-3 border`,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
          ]}
        >
          <MaterialCommunityIcons name="cash-multiple" size={24} color={colors.primary} />
          <View style={[tw`flex-1 ${isRTL ? 'mr-2.5' : 'ml-2.5'}`]}>
            <Text style={[tw`text-xs font-bold`, { color: colors.primary }]}>
              {t('checkout.cashOnDelivery')}
            </Text>
            <Text style={[tw`text-[11px] mt-0.5`, { color: colors.textPrimary }]}>
              {t('checkout.codDescription')}
            </Text>
          </View>
        </View>

        {/* 2. Delivery Method Selector (Courier vs Pickup) */}
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              tw`font-bold text-base mb-3`,
              { color: colors.textPrimary, textAlign: isRTL ? 'right' : 'left' },
            ]}
          >
            {t('checkout.deliveryMethod')}
          </Text>

          <View style={tw`flex-row items-center justify-between`}>
            {/* Courier Button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setDeliveryMethod('Courier')}
              style={[
                tw`flex-1 p-3 rounded-xl border ${isRTL ? 'ml-2' : 'mr-2'}`,
                {
                  backgroundColor: deliveryMethod === 'Courier' ? colors.primarySoft : colors.screenBg,
                  borderColor: deliveryMethod === 'Courier' ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={tw`flex-row items-center mb-1`}>
                <MaterialCommunityIcons
                  name="truck-delivery-outline"
                  size={20}
                  color={deliveryMethod === 'Courier' ? colors.primary : colors.textSecondary}
                />
                <Text
                  style={[
                    tw`font-bold text-xs ${isRTL ? 'mr-1.5' : 'ml-1.5'}`,
                    { color: deliveryMethod === 'Courier' ? colors.primary : colors.textPrimary },
                  ]}
                >
                  {t('checkout.homeDelivery')}
                </Text>
              </View>
              <Text style={[tw`text-[10px]`, { color: colors.textSecondary }]}>
                {t('checkout.homeDeliveryDesc')}
              </Text>
            </TouchableOpacity>

            {/* Pickup Button (Bosta branch) */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setDeliveryMethod('Pickup')}
              style={[
                tw`flex-1 p-3 rounded-xl border ${isRTL ? 'mr-2' : 'ml-2'}`,
                {
                  backgroundColor: deliveryMethod === 'Pickup' ? colors.primarySoft : colors.screenBg,
                  borderColor: deliveryMethod === 'Pickup' ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={tw`flex-row items-center mb-1`}>
                <MaterialCommunityIcons
                  name="store-outline"
                  size={20}
                  color={deliveryMethod === 'Pickup' ? colors.primary : colors.textSecondary}
                />
                <Text
                  style={[
                    tw`font-bold text-xs ${isRTL ? 'mr-1.5' : 'ml-1.5'}`,
                    { color: deliveryMethod === 'Pickup' ? colors.primary : colors.textPrimary },
                  ]}
                >
                  {t('checkout.branchPickup')}
                </Text>
              </View>
              <Text style={[tw`text-[10px]`, { color: colors.textSecondary }]}>
                {t('checkout.branchPickupDesc')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 3. Recipient & Address Details */}
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <Text
            style={[
              tw`font-bold text-base mb-3`,
              { color: colors.textPrimary, textAlign: isRTL ? 'right' : 'left' },
            ]}
          >
            {deliveryMethod === 'Courier' ? t('checkout.deliveryAddress') : t('checkout.pickupPoint')}
          </Text>

          {/* Recipient Full Name */}
          <Text
            style={[
              tw`text-xs font-semibold mb-1`,
              { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' },
            ]}
          >
            {t('checkout.recipientName')} *
          </Text>
          <TextInput
            style={[
              tw`border rounded-xl px-3.5 py-2.5 text-sm mb-2.5`,
              {
                borderColor: colors.border,
                backgroundColor: colors.screenBg,
                color: colors.textPrimary,
                textAlign: isRTL ? 'right' : 'left',
              },
            ]}
            value={recipientName}
            onChangeText={setRecipientName}
            placeholder={isRTL ? 'مثال: أحمد محمد علي' : 'e.g. Ahmed Mohamed'}
            placeholderTextColor={colors.textSecondary}
          />

          {/* Recipient Egyptian Phone */}
          <Text
            style={[
              tw`text-xs font-semibold mb-1`,
              { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' },
            ]}
          >
            {t('checkout.recipientPhone')} *
          </Text>
          <TextInput
            style={[
              tw`border rounded-xl px-3.5 py-2.5 text-sm mb-3`,
              {
                borderColor: colors.border,
                backgroundColor: colors.screenBg,
                color: colors.textPrimary,
                textAlign: isRTL ? 'right' : 'left',
              },
            ]}
            keyboardType="phone-pad"
            value={recipientPhone}
            onChangeText={setRecipientPhone}
            placeholder="010xxxxxxxx"
            placeholderTextColor={colors.textSecondary}
          />

          {deliveryMethod === 'Courier' ? (
            <View>
              {/* Saved Address Quick Select */}
              {savedAddresses.length > 0 && (
                <View style={tw`mb-3`}>
                  <Text
                    style={[
                      tw`text-xs font-bold mb-2`,
                      { color: colors.primary, textAlign: isRTL ? 'right' : 'left' },
                    ]}
                  >
                    {t('checkout.selectSavedAddress')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {savedAddresses.map((addr) => (
                      <TouchableOpacity
                        key={`checkout-addr-${addr.id}`}
                        onPress={() => handleSelectSavedAddress(addr)}
                        style={[
                          tw`p-2.5 rounded-xl border mr-2`,
                          {
                            borderColor: selectedAddressId === addr.id ? colors.primary : colors.border,
                            backgroundColor: selectedAddressId === addr.id ? colors.primarySoft : colors.screenBg,
                            minWidth: 140,
                          },
                        ]}
                      >
                        <Text style={[tw`font-bold text-xs`, { color: colors.textPrimary }]}>
                          {addr.label || (isRTL ? 'عنوان' : 'Address')}
                        </Text>
                        <Text style={[tw`text-[11px] mt-0.5`, { color: colors.textSecondary }]}>
                          {addr.governorate}، {addr.city}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* 4 Egyptian Address Fields */}
              <View style={tw`flex-row justify-between mb-2.5`}>
                <View style={tw`flex-1 mr-1.5`}>
                  <Text style={[tw`text-xs font-semibold mb-1`, { color: colors.textSecondary }]}>
                    {t('checkout.governorate')} *
                  </Text>
                  <TextInput
                    style={[
                      tw`border rounded-xl px-3 py-2 text-sm`,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.screenBg,
                        color: colors.textPrimary,
                        textAlign: isRTL ? 'right' : 'left',
                      },
                    ]}
                    value={governorate}
                    onChangeText={setGovernorate}
                    placeholder={isRTL ? 'القاهرة' : 'Cairo'}
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>

                <View style={tw`flex-1 ml-1.5`}>
                  <Text style={[tw`text-xs font-semibold mb-1`, { color: colors.textSecondary }]}>
                    {t('checkout.city')} *
                  </Text>
                  <TextInput
                    style={[
                      tw`border rounded-xl px-3 py-2 text-sm`,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.screenBg,
                        color: colors.textPrimary,
                        textAlign: isRTL ? 'right' : 'left',
                      },
                    ]}
                    value={city}
                    onChangeText={setCity}
                    placeholder={isRTL ? 'مدينة نصر' : 'Nasr City'}
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>

              <View style={tw`mb-2.5`}>
                <Text style={[tw`text-xs font-semibold mb-1`, { color: colors.textSecondary }]}>
                  {t('checkout.area')} *
                </Text>
                <TextInput
                  style={[
                    tw`border rounded-xl px-3.5 py-2 text-sm`,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.screenBg,
                      color: colors.textPrimary,
                      textAlign: isRTL ? 'right' : 'left',
                    },
                  ]}
                  value={area}
                  onChangeText={setArea}
                  placeholder={isRTL ? 'الحي / المنطقة' : 'District / Area'}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>

              <View style={tw`mb-1`}>
                <Text style={[tw`text-xs font-semibold mb-1`, { color: colors.textSecondary }]}>
                  {t('checkout.streetBuilding')} *
                </Text>
                <TextInput
                  style={[
                    tw`border rounded-xl px-3.5 py-2 text-sm`,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.screenBg,
                      color: colors.textPrimary,
                      textAlign: isRTL ? 'right' : 'left',
                    },
                  ]}
                  value={streetBuilding}
                  onChangeText={setStreetBuilding}
                  placeholder={isRTL ? 'الشارع ورقم العمارة والدور والشقة' : 'Street, building, floor & apt'}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
          ) : (
            /* Pickup Branch Selector */
            <View>
              {/* City Selector */}
              <Text style={[tw`text-xs font-semibold mb-1.5`, { color: colors.textSecondary }]}>
                {isRTL ? 'اختر المحافظة / المدينة:' : 'Select Governorate / City:'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tw`mb-3`}>
                {(availableCities.length > 0
                  ? availableCities
                  : [
                      { name: isRTL ? 'القاهرة' : 'Cairo' },
                      { name: isRTL ? 'الجيزة' : 'Giza' },
                      { name: isRTL ? 'الإسكندرية' : 'Alexandria' },
                    ]
                ).map((c) => (
                  <TouchableOpacity
                    key={`pickup-city-${c.name}`}
                    onPress={() => handleCityChangeForPickup(c.name)}
                    style={[
                      tw`px-3.5 py-1.5 rounded-full border mr-2`,
                      {
                        backgroundColor: pickupCity === c.name ? colors.primary : colors.screenBg,
                        borderColor: pickupCity === c.name ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        tw`text-xs font-bold`,
                        { color: pickupCity === c.name ? colors.white : colors.textPrimary },
                      ]}
                    >
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Pickup Point Cards */}
              <Text style={[tw`text-xs font-semibold mb-2`, { color: colors.textSecondary }]}>
                {t('checkout.choosePickupPoint')}:
              </Text>
              {pickupPoints.map((point) => (
                <TouchableOpacity
                  key={`point-${point.id}`}
                  onPress={() => setSelectedPickupPointId(point.id)}
                  style={[
                    tw`p-3 rounded-xl border mb-2`,
                    {
                      borderColor: selectedPickupPointId === point.id ? colors.primary : colors.border,
                      backgroundColor: selectedPickupPointId === point.id ? colors.primarySoft : colors.screenBg,
                    },
                  ]}
                >
                  <View style={tw`flex-row items-center justify-between mb-1`}>
                    <Text style={[tw`font-bold text-xs`, { color: colors.textPrimary }]}>
                      {point.name}
                    </Text>
                    {selectedPickupPointId === point.id && (
                      <MaterialCommunityIcons name="check-circle" size={16} color={colors.primary} />
                    )}
                  </View>
                  <Text style={[tw`text-[11px]`, { color: colors.textSecondary }]}>
                    {point.address}
                  </Text>
                  {point.workHours && (
                    <Text style={[tw`text-[10px] mt-0.5`, { color: colors.primary }]}>
                      {isRTL ? 'مواعيد العمل:' : 'Working hours:'} {point.workHours}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* 4. Per-Seller Parcels Breakdown */}
        {quoteData?.parcels && quoteData.parcels.length > 0 && (
          <View
            style={[
              cardShadow,
              tw`rounded-2xl p-4 mb-3 border`,
              { backgroundColor: colors.cardBg, borderColor: colors.border },
            ]}
          >
            <View style={tw`flex-row items-center justify-between mb-3`}>
              <Text style={[tw`font-bold text-base`, { color: colors.textPrimary }]}>
                {t('checkout.parcelsBreakdown')}
              </Text>
              <View style={[tw`px-2.5 py-0.5 rounded-full`, { backgroundColor: colors.primarySoft }]}>
                <Text style={[tw`text-xs font-bold`, { color: colors.primary }]}>
                  {quoteData.parcels.length} {quoteData.parcels.length === 1 ? (isRTL ? 'شحنة' : 'parcel') : (isRTL ? 'شحنات منفصلة' : 'parcels')}
                </Text>
              </View>
            </View>

            {quoteData.parcels.map((parcel, idx) => {
              const parcelItemsSubtotal = (parcel.items || []).reduce(
                (sum, it) => sum + (Number(it.unitPrice) || 0) * (it.quantity || 1),
                0
              );
              const parcelCodAmount = parcel.codAmount || (parcelItemsSubtotal + (parcel.deliveryCost || 0));

              return (
                <View
                  key={`quote-parcel-${parcel.sellerId || idx}`}
                  style={[
                    tw`p-3 rounded-xl border mb-2.5`,
                    { borderColor: colors.border, backgroundColor: colors.screenBg },
                  ]}
                >
                  <View style={tw`flex-row items-center justify-between mb-1.5`}>
                    <Text style={[tw`font-bold text-xs`, { color: colors.textPrimary }]}>
                      {t('checkout.sellerParcel', { seller: parcel.sellerName || (isRTL ? `تاجر رقم ${parcel.sellerId}` : `Seller #${parcel.sellerId}`) })}
                    </Text>
                    <Text style={[tw`text-xs font-semibold`, { color: colors.primary }]}>
                      {isRTL ? 'الشحن:' : 'Shipping:'} {formatCurrency(parcel.deliveryCost)}
                    </Text>
                  </View>

                  <Text style={[tw`text-[11px]`, { color: colors.textSecondary }]}>
                    {t('checkout.fromCity', { city: parcel.dispatchCity || (isRTL ? 'القاهرة' : 'Cairo') })} • {t('checkout.eta', { min: parcel.etaMinDays, max: parcel.etaMaxDays })}
                  </Text>

                  {/* Shipment COD Badge */}
                  <View
                    style={[
                      tw`mt-2 pt-2 border-t border-gray-100 flex-row items-center justify-between`,
                    ]}
                  >
                    <Text style={[tw`text-[11px] font-medium`, { color: colors.textSecondary }]}>
                      {isRTL ? 'مبلغ التحصيل لهذه الشحنة (COD):' : 'COD Amount for this shipment:'}
                    </Text>
                    <Text style={[tw`text-xs font-bold`, { color: colors.accent }]}>
                      {formatCurrency(parcelCodAmount)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* 5. Order Items Summary */}
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <View style={tw`flex-row items-center justify-between mb-3`}>
            <Text style={[tw`text-base font-bold`, { color: colors.textPrimary }]}>
              {t('cart.orderSummary')}
            </Text>
            <Text style={[tw`text-xs font-medium`, { color: colors.textSecondary }]}>
              {totalCount} {totalCount === 1 ? (isRTL ? 'منتج' : 'item') : (isRTL ? 'منتجات' : 'items')}
            </Text>
          </View>

          {checkoutItems.map((item, index) => {
            const product = item?.product || {};
            const unitPrice = item?.selectedVariant?.priceOverride != null
              ? item.selectedVariant.priceOverride
              : (Number(product.price) || 0);
            const imageUrl = getImageUrl(item?.selectedVariant?.imageUrl || product?.imageUrls?.[0]);
            const linePrice = unitPrice * (Number(item.quantity) || 1);

            return (
              <View
                key={`checkout-it-${item.productId}-${item.variantId || 'base'}-${index}`}
                style={[
                  tw`flex-row items-center py-2.5`,
                  index < checkoutItems.length - 1 && tw`border-b border-gray-100`,
                ]}
              >
                <View
                  style={[
                    tw`rounded-lg overflow-hidden ${isRTL ? 'ml-3' : 'mr-3'}`,
                    { width: 50, height: 50, backgroundColor: colors.placeholderBg },
                  ]}
                >
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={tw`w-full h-full`} contentFit="cover" />
                  ) : (
                    <View style={tw`w-full h-full items-center justify-center`}>
                      <MaterialCommunityIcons name="image-off-outline" size={18} color={colors.textSecondary} />
                    </View>
                  )}
                </View>

                <View style={[tw`flex-1 ${isRTL ? 'ml-2' : 'mr-2'}`]}>
                  <Text numberOfLines={1} style={[tw`font-semibold text-sm`, { color: colors.textPrimary }]}>
                    {product.name}
                  </Text>
                  {item.selectedVariant ? (
                    <Text style={[tw`text-[11px] font-semibold mt-0.5`, { color: colors.primary }]}>
                      {[
                        item.selectedVariant.size ? (isRTL ? `مقاس ${item.selectedVariant.size}` : `Size ${item.selectedVariant.size}`) : null,
                        item.selectedVariant.color ? item.selectedVariant.color : null,
                        item.selectedVariant.attributeName && item.selectedVariant.attributeValue
                          ? `${item.selectedVariant.attributeName}: ${item.selectedVariant.attributeValue}`
                          : null,
                      ].filter(Boolean).join(' • ') || (isRTL ? 'خيار محدد' : 'Selected option')}
                    </Text>
                  ) : null}
                  <Text style={[tw`text-xs mt-0.5`, { color: colors.textSecondary }]}>
                    {`${formatCurrency(unitPrice)} × ${item.quantity}`}
                  </Text>
                </View>

                <Text style={[tw`font-bold text-sm`, { color: colors.textPrimary }]}>
                  {formatCurrency(linePrice)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Promo Code / Coupon Engine Card */}
        {couponsEnabled && (
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <View style={tw`flex-row items-center justify-between mb-2.5`}>
            <View style={tw`flex-row items-center`}>
              <MaterialCommunityIcons name="ticket-percent-outline" size={20} color={colors.primary} />
              <Text style={[tw`font-bold text-sm ${isRTL ? 'mr-1.5' : 'ml-1.5'}`, { color: colors.textPrimary }]}>
                {t('checkout.promoCode')}
              </Text>
            </View>
            {appliedCoupon ? (
              <View style={[tw`px-2 py-0.5 rounded-full`, { backgroundColor: colors.newBadgeSoft }]}>
                <Text style={[tw`text-xs font-bold`, { color: colors.newBadge }]}>
                  {isRTL ? 'خصم' : 'Discount'} {formatCurrency(appliedCoupon.discountAmount)}
                </Text>
              </View>
            ) : null}
          </View>

          {appliedCoupon ? (
            <View
              style={[
                tw`flex-row items-center justify-between p-3 rounded-xl border`,
                { borderColor: colors.newBadge, backgroundColor: '#F0FDF4' },
              ]}
            >
              <View>
                <Text style={[tw`font-bold text-xs`, { color: colors.newBadge }]}>
                  {isRTL ? 'تم تطبيق الكوبون:' : 'Applied coupon:'} {appliedCoupon.code}
                </Text>
                <Text style={[tw`text-[11px] mt-0.5`, { color: colors.textSecondary }]}>
                  {isRTL ? 'قيمة الخصم المحتسبة:' : 'Calculated discount:'} {formatCurrency(appliedCoupon.discountAmount)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleRemoveCoupon}
                style={[tw`px-3 py-1.5 rounded-lg border`, { borderColor: colors.discount, backgroundColor: colors.dangerSoft }]}
              >
                <Text style={[tw`text-xs font-bold`, { color: colors.discount }]}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={tw`flex-row items-center`}>
              <TextInput
                style={[
                  tw`flex-1 border rounded-xl px-3.5 py-2.5 text-sm ${isRTL ? 'ml-2' : 'mr-2'}`,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.screenBg,
                    color: colors.textPrimary,
                    textAlign: isRTL ? 'right' : 'left',
                  },
                ]}
                value={couponCodeInput}
                onChangeText={(txt) => setCouponCodeInput(txt.toUpperCase())}
                placeholder={t('checkout.promoPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={validatingCoupon || !couponCodeInput.trim()}
                onPress={handleApplyCoupon}
                style={[
                  tw`px-4 py-2.5 rounded-xl items-center justify-center`,
                  {
                    backgroundColor: !couponCodeInput.trim() ? colors.disabledBg : colors.primary,
                    minHeight: 44,
                  },
                ]}
              >
                {validatingCoupon ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={[tw`font-bold text-xs text-white`]}>{t('checkout.applyPromo')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {/* Buyer Wallet (Store Credit) Balance Card */}
        {walletEnabled && (
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <View style={tw`flex-row items-center justify-between`}>
            <View style={tw`flex-row items-center flex-1`}>
              <MaterialCommunityIcons name="wallet-outline" size={22} color={colors.accent} />
              <View style={[tw`${isRTL ? 'mr-2' : 'ml-2'} flex-1`]}>
                <Text style={[tw`font-bold text-sm`, { color: colors.textPrimary }]}>
                  {t('checkout.useWallet')}
                </Text>
                <Text style={[tw`text-[11px] mt-0.5`, { color: colors.textSecondary }]}>
                  {isRTL ? 'الرصيد المتاح:' : 'Available balance:'} {formatCurrency(walletBalance)}
                </Text>
              </View>
            </View>

            <Switch
              value={useWalletBalance && walletBalance > 0}
              onValueChange={(val) => {
                if (walletBalance <= 0 && val) {
                  Alert.alert(t('checkout.walletTitle'), t('checkout.walletEmptyNotice'));
                  return;
                }
                setUseWalletBalance(val);
              }}
              trackColor={{ false: colors.border, true: colors.primarySoft }}
              thumbColor={useWalletBalance && walletBalance > 0 ? colors.primary : '#94A3B8'}
              disabled={walletBalance <= 0}
            />
          </View>

          {useWalletBalance && walletDeduction > 0 && (
            <View
              style={[
                tw`mt-3 p-2.5 rounded-xl border flex-row items-center justify-between`,
                { borderColor: colors.newBadge, backgroundColor: '#F0FDF4' },
              ]}
            >
              <Text style={[tw`text-xs font-semibold`, { color: colors.newBadge }]}>
                {t('checkout.walletDeducted')}
              </Text>
              <Text style={[tw`text-xs font-bold`, { color: colors.newBadge }]}>
                -{formatCurrency(walletDeduction)}
              </Text>
            </View>
          )}
        </View>
        )}

        {/* 6. Pricing Breakdown */}
        <View
          style={[
            cardShadow,
            tw`rounded-2xl p-4 mb-3 border`,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <View style={tw`flex-row items-center justify-between mb-2`}>
            <Text style={[tw`text-sm`, { color: colors.textSecondary }]}>
              {t('checkout.itemsTotal')}
            </Text>
            <Text style={[tw`text-sm font-semibold`, { color: colors.textPrimary }]}>
              {formatCurrency(itemsSubtotal)}
            </Text>
          </View>

          <View style={tw`flex-row items-center justify-between mb-2`}>
            <Text style={[tw`text-sm`, { color: colors.textSecondary }]}>
              {t('checkout.deliveryTotal')}
            </Text>
            <Text style={[tw`text-sm font-semibold`, { color: colors.primary }]}>
              {quoteLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : isFreeShipping ? (
                t('checkout.free')
              ) : (
                formatCurrency(deliveryCostTotal)
              )}
            </Text>
          </View>

          {couponsEnabled && couponDiscount > 0 && (
            <View style={tw`flex-row items-center justify-between mb-2`}>
              <Text style={[tw`text-sm font-semibold`, { color: colors.newBadge }]}>
                {isRTL ? `خصم الكوبون (${appliedCoupon?.code})` : `Coupon Discount (${appliedCoupon?.code})`}
              </Text>
              <Text style={[tw`text-sm font-bold`, { color: colors.newBadge }]}>
                -{formatCurrency(couponDiscount)}
              </Text>
            </View>
          )}

          {walletEnabled && walletDeduction > 0 && (
            <View style={tw`flex-row items-center justify-between mb-2`}>
              <Text style={[tw`text-sm font-semibold`, { color: colors.newBadge }]}>
                {t('checkout.walletDeduction')}
              </Text>
              <Text style={[tw`text-sm font-bold`, { color: colors.newBadge }]}>
                -{formatCurrency(walletDeduction)}
              </Text>
            </View>
          )}

          <View style={tw`border-t border-gray-100 pt-3 mt-1 flex-row items-center justify-between`}>
            <Text style={[tw`text-base font-bold`, { color: colors.textPrimary }]}>
              {t('checkout.grandTotal')}
            </Text>
            <Text style={[tw`text-xl font-bold`, { color: colors.primary }]}>
              {grandTotal === 0 ? t('checkout.paidInFullWallet') : formatCurrency(grandTotal)}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom Order Confirmation Bar */}
      <View
        style={[
          cardShadow,
          tw`px-4 pt-3 pb-6 border-t`,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={submitting || checkoutItems.length === 0}
          onPress={handleConfirmOrder}
          style={{ borderRadius: 14, overflow: 'hidden' }}
        >
          <LinearGradient
            colors={
              submitting || checkoutItems.length === 0
                ? [colors.disabledBg, colors.disabledBg]
                : [colors.accent, '#FF8C33']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              tw`w-full flex-row items-center justify-center`,
              { minHeight: 52 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <MaterialCommunityIcons name="check-circle-outline" size={22} color={colors.white} />
                <Text style={[tw`font-bold text-base ${isRTL ? 'mr-2' : 'ml-2'}`, { color: colors.white }]}>
                  {t('checkout.confirmOrder')} • {formatCurrency(grandTotal)}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}
