import { getAppConfig } from '../../api/configApi';
import tw from 'twrnc';
import React, { useState, useEffect, useContext, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Modal,
  Switch,
  Platform,
  I18nManager,
  Image,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import { AuthContext } from '../../context/AuthContext';
import {
  getMyProfile,
  updateMyProfile,
  changePassword,
  getMySellerProfile,
  updateMySellerProfile,
  getMyAddresses,
  createMyAddress,
  updateMyAddress,
  deleteMyAddress,
  getBuyerDashboard,
  exportMyData,
  deleteMyAccount,
  getMyWallet,
} from '../../api/usersApi';
import { changeAppLanguage } from '../../locales/i18n';
import { isValidEgyptianPhone, formatEgyptianPhone } from '../../utils/egyptianPhone';
import { formatCurrency } from '../../utils/currency';
import { colors } from '../../theme/colors';
import { checkBiometricSupport, promptBiometricAuth } from '../../utils/biometrics';
import { isBiometricsEnabled, setBiometricsEnabled, removeRefreshToken } from '../../utils/storage';

const cardShadow = Platform.select({
  ios: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  android: {
    elevation: 2,
  },
  default: {},
});

const getInitials = (name) => {
  if (!name || typeof name !== 'string') return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return String(dateStr);
  }
};

export default function ProfileScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { logout, reloadUser, userId } = useContext(AuthContext);
  const [biometricSupport, setBiometricSupport] = useState({ available: false });
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);
  const isFocused = useIsFocused();
  const isArabicActive = i18n.language?.startsWith('ar');
  const isRTL = isArabicActive;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Buyer Dashboard Hub State
  const [buyerDashboard, setBuyerDashboard] = useState({
    processingCount: 0,
    inTransitCount: 0,
    readyForPickupCount: 0,
    deliveredCount: 0,
    returnedCount: 0,
    activeShipment: null,
    totalSpent: 0,
    totalOrdersPlaced: 0,
    savedAddressesCount: 0,
    codEligibilityStatus: {
      isCodBlocked: false,
      refusedDeliveriesCount: 0,
      maxRefusalTolerance: 3,
      remainingTolerance: 3,
      statusMessage: isArabicActive ? 'الدفع عند الاستلام متاح' : 'Cash on delivery available',
    },
  });

  // Edit Name State
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Change Password State
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Addresses State
  const [addresses, setAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addressForm, setAddressForm] = useState({
    label: '',
    recipientName: '',
    recipientPhone: '',
    governorate: '',
    city: '',
    area: '',
    streetBuilding: '',
    isDefault: false,
  });
  const [savingAddress, setSavingAddress] = useState(false);

  // Seller Profile State (for sellers)
  const [sellerProfile, setSellerProfile] = useState({
    dispatchCity: '',
    dispatchAddress: '',
    contactPhone: '',
  });
  const [loadingSellerProfile, setLoadingSellerProfile] = useState(false);
  const [savingSellerProfile, setSavingSellerProfile] = useState(false);

  // PDPL 151/2020 State
  const [exportingData, setExportingData] = useState(false);
  const [deleteAccountModalVisible, setDeleteAccountModalVisible] = useState(false);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Buyer Wallet (Store Credit) State
  const [walletData, setWalletData] = useState({ balance: 0, transactions: [] });
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [walletEnabled, setWalletEnabled] = useState(false);

  const loadData = useCallback(async (isPull = false) => {
    try {
      if (isPull) setRefreshing(true);
      else setLoading(true);

      const [profileRes, addressesRes] = await Promise.allSettled([
        getMyProfile(),
        getMyAddresses(),
      ]);

      if (profileRes.status === 'fulfilled' && profileRes.value?.data) {
        const u = profileRes.value.data;
        setProfile(u);
        setNameInput(u.name || '');

        if (u.role === 'Seller') {
          loadSellerProfile();
        } else {
          // Fetch Buyer Dashboard & Config/Wallet
          try {
            const [bDashRes, configRes] = await Promise.allSettled([
              getBuyerDashboard(),
              getAppConfig(),
            ]);
            if (bDashRes.status === 'fulfilled' && bDashRes.value?.data) {
              setBuyerDashboard(bDashRes.value.data);
            }
            if (configRes.status === 'fulfilled' && configRes.value?.data?.walletEnabled) {
              setWalletEnabled(true);
              try {
                const walletRes = await getMyWallet();
                if (walletRes?.data) {
                  setWalletData(walletRes.data);
                }
              } catch (we) {
                console.warn('Failed to load wallet data', we);
              }
            }
          } catch (e) {
            console.error('Failed to load buyer dashboard/wallet', e);
          }
        }
      }

      if (addressesRes.status === 'fulfilled' && Array.isArray(addressesRes.value?.data)) {
        setAddresses(addressesRes.value.data);
      }
    } catch (err) {
      console.error('Failed to load profile data', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadSellerProfile = async () => {
    try {
      setLoadingSellerProfile(true);
      const res = await getMySellerProfile();
      if (res?.data) {
        setSellerProfile({
          dispatchCity: res.data.dispatchCity || '',
          dispatchAddress: res.data.dispatchAddress || '',
          contactPhone: res.data.contactPhone || '',
        });
      }
    } catch (err) {
      console.error('Failed to load seller profile', err);
    } finally {
      setLoadingSellerProfile(false);
    }
  };

  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused, loadData]);

  useEffect(() => {
    let isMounted = true;
    const loadBiometrics = async () => {
      const support = await checkBiometricSupport();
      if (isMounted) {
        setBiometricSupport(support);
      }
      if (userId && isMounted) {
        const enabled = await isBiometricsEnabled(userId);
        if (isMounted) {
          setBiometricsEnabledState(enabled);
        }
      }
    };
    loadBiometrics();
    return () => {
      isMounted = false;
    };
  }, [userId, isFocused]);

  const handleToggleBiometrics = async (value) => {
    if (!userId) return;

    if (value) {
      const promptRes = await promptBiometricAuth({
        promptMessage: t('biometrics.authenticateToEnable', 'تأكيد البصمة لتفعيل الميزة'),
        fallbackLabel: t('biometrics.usePasscode', 'استخدم رمز الهاتف'),
      });

      if (promptRes.success) {
        await setBiometricsEnabled(userId, true);
        setBiometricsEnabledState(true);
        Alert.alert(t('common.success', 'تم بنجاح'), t('biometrics.enabledSuccess', 'تم تفعيل الدخول بالبصمة بنجاح'));
      } else {
        setBiometricsEnabledState(false);
      }
    } else {
      await setBiometricsEnabled(userId, false);
      setBiometricsEnabledState(false);
      Alert.alert(t('common.success', 'تم بنجاح'), t('biometrics.disabledSuccess', 'تم إيقاف الدخول بالبصمة'));
    }
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      Alert.alert(t('common.error'), isRTL ? 'الاسم يجب أن يكون بين حرفين و 100 حرف' : 'Name must be between 2 and 100 characters');
      return;
    }

    try {
      setSavingName(true);
      const res = await updateMyProfile({ name: trimmed });
      if (res?.data) {
        setProfile(res.data);
        setNameInput(res.data.name);
        setIsEditingName(false);
        if (reloadUser) await reloadUser();
        Alert.alert(t('common.save'), isRTL ? 'تم تحديث الاسم بنجاح' : 'Name updated successfully');
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePassword = async () => {
    if (!currentPassword) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('common.error'), isRTL ? 'كلمة المرور يجب ألا تقل عن 6 أحرف' : 'Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('common.error'), isRTL ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }

    try {
      setSavingPassword(true);
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsChangingPassword(false);
      if (userId) {
        await removeRefreshToken(userId);
      }
      Alert.alert(t('common.success', 'تم بنجاح'), t('profile.passwordChanged'), [
        { text: t('common.ok', 'حسناً'), onPress: () => logout() }
      ]);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveSellerProfile = async () => {
    if (!sellerProfile.dispatchCity?.trim()) {
      Alert.alert(t('common.error'), isRTL ? 'يرجى تحديد محافظة أو مدينة الشحن للتاجر' : 'Please select dispatch city for seller');
      return;
    }

    try {
      setSavingSellerProfile(true);
      await updateMySellerProfile({
        dispatchCity: sellerProfile.dispatchCity.trim(),
        dispatchAddress: sellerProfile.dispatchAddress?.trim() || null,
        contactPhone: sellerProfile.contactPhone?.trim() || null,
      });
      Alert.alert(t('common.save'), t('profile.sellerProfileSaved'));
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingSellerProfile(false);
    }
  };

  const openAddressModal = (address = null) => {
    if (address) {
      setEditingAddressId(address.id);
      setAddressForm({
        label: address.label || '',
        recipientName: address.recipientName || '',
        recipientPhone: address.recipientPhone || '',
        governorate: address.governorate || '',
        city: address.city || '',
        area: address.area || '',
        streetBuilding: address.streetBuilding || '',
        isDefault: Boolean(address.isDefault),
      });
    } else {
      setEditingAddressId(null);
      setAddressForm({
        label: '',
        recipientName: profile?.name || '',
        recipientPhone: '',
        governorate: '',
        city: '',
        area: '',
        streetBuilding: '',
        isDefault: addresses.length === 0,
      });
    }
    setAddressModalVisible(true);
  };

  const handleSaveAddress = async () => {
    if (
      !addressForm.recipientName.trim() ||
      !addressForm.recipientPhone.trim() ||
      !addressForm.governorate.trim() ||
      !addressForm.city.trim() ||
      !addressForm.area.trim() ||
      !addressForm.streetBuilding.trim()
    ) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }

    if (!isValidEgyptianPhone(addressForm.recipientPhone)) {
      Alert.alert(t('common.error'), t('common.invalidPhone'));
      return;
    }

    try {
      setSavingAddress(true);
      const payload = {
        label: addressForm.label.trim() || null,
        recipientName: addressForm.recipientName.trim(),
        recipientPhone: addressForm.recipientPhone.trim(),
        governorate: addressForm.governorate.trim(),
        city: addressForm.city.trim(),
        area: addressForm.area.trim(),
        streetBuilding: addressForm.streetBuilding.trim(),
        isDefault: addressForm.isDefault,
      };

      if (editingAddressId) {
        await updateMyAddress(editingAddressId, payload);
      } else {
        await createMyAddress(payload);
      }

      setAddressModalVisible(false);
      const refreshed = await getMyAddresses();
      if (Array.isArray(refreshed?.data)) setAddresses(refreshed.data);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSavingAddress(false);
    }
  };

  const handleDeleteAddress = (id) => {
    Alert.alert(t('common.delete'), t('profile.deleteAddressConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMyAddress(id);
            const refreshed = await getMyAddresses();
            if (Array.isArray(refreshed?.data)) setAddresses(refreshed.data);
          } catch (err) {
            Alert.alert(t('common.error'), err?.message || t('common.error'));
          }
        },
      },
    ]);
  };

  const handleSetDefaultAddress = async (address) => {
    try {
      await updateMyAddress(address.id, { ...address, isDefault: true });
      const refreshed = await getMyAddresses();
      if (Array.isArray(refreshed?.data)) setAddresses(refreshed.data);
    } catch (err) {
      Alert.alert(t('common.error'), err?.message || t('common.error'));
    }
  };

  const handleLanguageChange = async (lang) => {
    if (i18n.language === lang) return;
    await changeAppLanguage(lang);
  };

  // ─── PDPL 151/2020 Data Rights Handlers ───
  const handleExportData = async () => {
    try {
      setExportingData(true);
      const res = await exportMyData();
      if (res?.data) {
        Alert.alert(
          isRTL ? 'تصدير البيانات الشخصية (PDPL 151/2020)' : 'Personal Data Export (PDPL 151/2020)',
          isRTL
            ? `تم تجهيز وتصدير بياناتك بنجاح:\n• الحساب: ${res.data.name} (${res.data.email})\n• العناوين المسجلة: ${res.data.addresses?.length || 0}\n• الطلبات والشحنات: ${res.data.orders?.length || 0}\n• سجل الموافقات القانونية: ${res.data.consents?.length || 0}`
            : `Your data has been successfully prepared and exported:\n• Account: ${res.data.name} (${res.data.email})\n• Saved Addresses: ${res.data.addresses?.length || 0}\n• Orders & Shipments: ${res.data.orders?.length || 0}\n• Legal Consents: ${res.data.consents?.length || 0}`,
          [{ text: isRTL ? 'حسناً' : 'OK' }]
        );
      }
    } catch (err) {
      Alert.alert(t('common.error'), isRTL ? 'تعذر تصدير البيانات الشخصية' : 'Failed to export personal data');
    } finally {
      setExportingData(false);
    }
  };

  const handleDeleteAccountConfirm = async () => {
    if (!deletePasswordInput) {
      Alert.alert(t('common.error'), isRTL ? 'يرجى إدخال كلمة المرور لتأكيد حذف الحساب' : 'Please enter your password to confirm account deletion');
      return;
    }

    try {
      setDeletingAccount(true);
      await deleteMyAccount(deletePasswordInput);
      if (userId) {
        await removeRefreshToken(userId);
      }
      setDeleteAccountModalVisible(false);
      Alert.alert(
        isRTL ? 'تم حذف الحساب' : 'Account Deleted',
        isRTL ? 'تم محو بياناتك الشخصية بنجاح وفقاً للقانون 151 لسنة 2020.' : 'Your personal data has been erased in accordance with Law 151/2020.',
        [{ text: isRTL ? 'حسناً' : 'OK', onPress: () => logout() }]
      );
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || (isRTL ? 'تعذر حذف الحساب، تأكد من كلمة المرور' : 'Failed to delete account, check your password');
      Alert.alert(isRTL ? 'خطأ في الحذف' : 'Deletion Error', msg);
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logout'), t('profile.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.logout'), style: 'destructive', onPress: () => logout() },
    ]);
  };

  if (loading && !profile) {
    return (
      <View style={[tw`flex-1 justify-center items-center`, { backgroundColor: colors.screenBg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isBuyer = profile?.role !== 'Seller';
  const activeShipment = buyerDashboard.activeShipment;

  return (
    <View style={[tw`flex-1`, { backgroundColor: colors.screenBg }]}>
      <StatusBar barStyle="light-content" />

      {/* ─── 1. Personalized Header & Trust Badges (Executive Amazon/Noon Hub) ─── */}
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={tw`flex-row items-center justify-between mb-3`}>
          <View style={tw`flex-row items-center flex-1`}>
            {/* Avatar Circle */}
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{getInitials(profile?.name)}</Text>
            </View>

            <View style={tw`ml-3 flex-1`}>
              <View style={tw`flex-row items-center flex-wrap`}>
                <Text style={styles.userNameText} numberOfLines={1}>
                  {profile?.name || (isRTL ? 'مرحباً بك' : 'Welcome')}
                </Text>
                <View style={styles.trustBadge}>
                  <MaterialCommunityIcons name="check-decagram" size={13} color="#4ADE80" />
                  <Text style={styles.trustBadgeText}>{t('profile.verifiedEgypt')}</Text>
                </View>
              </View>
              <Text style={styles.userEmailText} numberOfLines={1}>
                {profile?.email}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setIsEditingName((p) => !p)}
            style={styles.editProfileBtn}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="account-edit-outline" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>

        {/* Edit Name Inline Bar */}
        {isEditingName && (
          <View style={styles.nameEditBox}>
            <TextInput
              style={styles.nameTextInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder={t('profile.namePlaceholder')}
              placeholderTextColor="#94A3B8"
              autoFocus
            />
            <View style={tw`flex-row justify-end mt-2`}>
              <TouchableOpacity onPress={() => setIsEditingName(false)} style={styles.nameCancelBtn}>
                <Text style={styles.nameCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveName} disabled={savingName} style={styles.nameSaveBtn}>
                {savingName ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.nameSaveText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Sleek Summary Bar (Orders, Addresses, Account Status) */}
        {isBuyer && (
          <View style={styles.summaryBar}>
            <TouchableOpacity
              style={styles.summaryCol}
              onPress={() => navigation?.navigate('MyOrders')}
              activeOpacity={0.8}
            >
              <Text style={styles.summaryNumber}>{buyerDashboard.totalOrdersPlaced}</Text>
              <Text style={styles.summaryLabel}>{t('profile.myOrdersCount')}</Text>
            </TouchableOpacity>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryCol}>
              <Text style={styles.summaryNumber}>{addresses.length}</Text>
              <Text style={styles.summaryLabel}>{t('profile.addressesCountLabel')}</Text>
            </View>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryCol}>
              <View style={tw`flex-row items-center justify-center`}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: buyerDashboard.codEligibilityStatus.isCodBlocked
                        ? '#DC2626'
                        : '#22C55E',
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.summaryStatusText,
                    {
                      color: buyerDashboard.codEligibilityStatus.isCodBlocked
                        ? '#FCA5A5'
                        : '#86EFAC',
                    },
                  ]}
                >
                  {buyerDashboard.codEligibilityStatus.isCodBlocked ? t('profile.codSuspended') : t('profile.codAvailable')}
                </Text>
              </View>
              <Text style={styles.summaryLabel}>{t('profile.codMethod')}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {/* ─── Scrollable Body ─── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            colors={[colors.accent]}
          />
        }
      >
        {isBuyer && (
          <>
            {/* ─── 2. "My Orders" Visual Status Bar (Shein/Noon Style) ─── */}
            <View style={tw`flex-row items-center justify-between mb-2.5 px-1`}>
              <Text style={[tw`font-bold text-base`, { color: colors.textPrimary }]}>
                {t('profile.buyerHubTitle')}
              </Text>
              <TouchableOpacity onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'All' })}>
                <Text style={[tw`text-xs font-bold`, { color: colors.accent }]}>{t('profile.viewAllOrders')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.orderStatusBarCard, cardShadow]}>
              {/* 1. Processing */}
              <TouchableOpacity
                style={styles.statusTile}
                onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'Processing' })}
                activeOpacity={0.75}
              >
                <View style={styles.statusIconWrap}>
                  <MaterialCommunityIcons name="clock-outline" size={24} color="#D97706" />
                  {buyerDashboard.processingCount > 0 && (
                    <View style={styles.badgeCount}>
                      <Text style={styles.badgeText}>{buyerDashboard.processingCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.statusTileLabel}>{t('profile.statusProcessing')}</Text>
              </TouchableOpacity>

              {/* 2. In Transit */}
              <TouchableOpacity
                style={styles.statusTile}
                onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'InTransit' })}
                activeOpacity={0.75}
              >
                <View style={styles.statusIconWrap}>
                  <MaterialCommunityIcons name="truck-delivery-outline" size={24} color="#2563EB" />
                  {buyerDashboard.inTransitCount > 0 && (
                    <View style={styles.badgeCount}>
                      <Text style={styles.badgeText}>{buyerDashboard.inTransitCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.statusTileLabel}>{t('profile.statusInTransit')}</Text>
              </TouchableOpacity>

              {/* 3. Ready For Pickup */}
              <TouchableOpacity
                style={styles.statusTile}
                onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'ReadyForPickup' })}
                activeOpacity={0.75}
              >
                <View style={styles.statusIconWrap}>
                  <MaterialCommunityIcons name="storefront-outline" size={24} color="#7C3AED" />
                  {buyerDashboard.readyForPickupCount > 0 && (
                    <View style={styles.badgeCount}>
                      <Text style={styles.badgeText}>{buyerDashboard.readyForPickupCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.statusTileLabel}>{t('profile.statusReadyPickup')}</Text>
              </TouchableOpacity>

              {/* 4. Delivered */}
              <TouchableOpacity
                style={styles.statusTile}
                onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'Delivered' })}
                activeOpacity={0.75}
              >
                <View style={styles.statusIconWrap}>
                  <MaterialCommunityIcons name="package-variant-closed-check" size={24} color="#16A34A" />
                  {buyerDashboard.deliveredCount > 0 && (
                    <View style={[styles.badgeCount, { backgroundColor: '#16A34A' }]}>
                      <Text style={styles.badgeText}>{buyerDashboard.deliveredCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.statusTileLabel}>{t('profile.statusDelivered')}</Text>
              </TouchableOpacity>

              {/* 5. Returned */}
              <TouchableOpacity
                style={styles.statusTile}
                onPress={() => navigation?.navigate('MyOrders', { filterStatus: 'Returned' })}
                activeOpacity={0.75}
              >
                <View style={styles.statusIconWrap}>
                  <MaterialCommunityIcons name="keyboard-return" size={24} color="#DC2626" />
                  {buyerDashboard.returnedCount > 0 && (
                    <View style={[styles.badgeCount, { backgroundColor: '#DC2626' }]}>
                      <Text style={styles.badgeText}>{buyerDashboard.returnedCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.statusTileLabel}>{t('profile.statusReturned')}</Text>
              </TouchableOpacity>
            </View>

            {/* ─── 2.5 Buyer Wallet (Store Credit) Balance Card ─── */}
            {walletEnabled && (
            <View
              style={[
                tw`rounded-2xl p-4 mb-3 border`,
                cardShadow,
                { backgroundColor: colors.cardBg, borderColor: colors.border },
              ]}
            >
              <View style={tw`flex-row items-center justify-between mb-2`}>
                <View style={tw`flex-row items-center`}>
                  <View style={[tw`w-10 h-10 rounded-xl items-center justify-center`, { backgroundColor: '#FFF7ED' }]}>
                    <MaterialCommunityIcons name="wallet" size={24} color={colors.accent} />
                  </View>
                  <View style={isRTL ? tw`mr-3` : tw`ml-3`}>
                    <Text style={[tw`text-xs font-semibold`, { color: colors.textSecondary }]}>
                      {t('profile.buyerWalletTitle')}
                    </Text>
                    <Text style={[tw`font-bold text-xl`, { color: colors.textPrimary }]}>
                      {formatCurrency(walletData?.balance || 0)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setShowWalletModal(true)}
                  style={[tw`px-3 py-1.5 rounded-lg border`, { borderColor: colors.accent, backgroundColor: '#FFF7ED' }]}
                >
                  <Text style={[tw`text-xs font-bold`, { color: colors.accent }]}>
                    {t('profile.txHistory')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[tw`text-[11px]`, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
                {t('profile.buyerWalletNotice')}
              </Text>
            </View>
            )}

            {/* ─── 3. Live Active Shipment Pin ─── */}
            {activeShipment && (
              <View style={[styles.activeShipmentCard, cardShadow]}>
                {/* Active Shipment Header */}
                <View style={tw`flex-row justify-between items-center mb-2`}>
                  <View style={tw`flex-row items-center`}>
                    <View style={styles.livePulseDot} />
                    <Text style={[tw`font-bold text-sm ${isRTL ? 'mr-1.5' : 'ml-1.5'}`, { color: colors.textPrimary }]}>
                      {t('profile.liveShipmentTitle')}
                    </Text>
                  </View>
                  <View style={styles.carrierTag}>
                    <Text style={styles.carrierTagText}>{t('profile.bostaCarrierTag')}</Text>
                  </View>
                </View>

                {/* Tracking & ETA */}
                <View style={tw`flex-row justify-between items-center mb-3 bg-gray-50 p-2.5 rounded-xl`}>
                  <Text style={[tw`text-xs font-mono`, { color: colors.textSecondary }]}>
                    {t('profile.trackingAirway', { number: activeShipment.trackingNumber || activeShipment.shipmentId })}
                  </Text>
                  <Text style={[tw`text-xs font-bold`, { color: colors.accent }]}>
                    {t('profile.etaDeliveryDays', { min: activeShipment.etaMinDays, max: activeShipment.etaMaxDays })}
                  </Text>
                </View>

                {/* 5-Step Stepper Progress Bar */}
                <View style={styles.stepperContainer}>
                  <View style={styles.stepperLine} />
                  <View
                    style={[
                      styles.stepperProgress,
                      { width: `${((activeShipment.currentStep - 1) / 4) * 100}%` },
                    ]}
                  />

                  {/* Step 1: Created */}
                  <View style={styles.stepNodeWrap}>
                    <View style={[styles.stepCircle, activeShipment.currentStep >= 1 && styles.stepCircleActive]}>
                      <MaterialCommunityIcons
                        name="check"
                        size={12}
                        color={activeShipment.currentStep >= 1 ? colors.white : '#94A3B8'}
                      />
                    </View>
                    <Text style={[styles.stepLabel, activeShipment.currentStep >= 1 && styles.stepLabelActive]}>
                      {t('profile.stepOrderConfirmed')}
                    </Text>
                  </View>

                  {/* Step 2: HandedToCarrier */}
                  <View style={styles.stepNodeWrap}>
                    <View style={[styles.stepCircle, activeShipment.currentStep >= 2 && styles.stepCircleActive]}>
                      <MaterialCommunityIcons
                        name="package-variant"
                        size={12}
                        color={activeShipment.currentStep >= 2 ? colors.white : '#94A3B8'}
                      />
                    </View>
                    <Text style={[styles.stepLabel, activeShipment.currentStep >= 2 && styles.stepLabelActive]}>
                      {t('profile.stepHandedBosta')}
                    </Text>
                  </View>

                  {/* Step 3: InTransit */}
                  <View style={styles.stepNodeWrap}>
                    <View style={[styles.stepCircle, activeShipment.currentStep >= 3 && styles.stepCircleActive]}>
                      <MaterialCommunityIcons
                        name="truck-fast"
                        size={12}
                        color={activeShipment.currentStep >= 3 ? colors.white : '#94A3B8'}
                      />
                    </View>
                    <Text style={[styles.stepLabel, activeShipment.currentStep >= 3 && styles.stepLabelActive]}>
                      {t('profile.stepInTransit')}
                    </Text>
                  </View>

                  {/* Step 4: ReadyForPickup */}
                  <View style={styles.stepNodeWrap}>
                    <View style={[styles.stepCircle, activeShipment.currentStep >= 4 && styles.stepCircleActive]}>
                      <MaterialCommunityIcons
                        name="storefront"
                        size={12}
                        color={activeShipment.currentStep >= 4 ? colors.white : '#94A3B8'}
                      />
                    </View>
                    <Text style={[styles.stepLabel, activeShipment.currentStep >= 4 && styles.stepLabelActive]}>
                      {t('profile.stepPickup')}
                    </Text>
                  </View>

                  {/* Step 5: Delivered */}
                  <View style={styles.stepNodeWrap}>
                    <View style={[styles.stepCircle, activeShipment.currentStep >= 5 && styles.stepCircleActive]}>
                      <MaterialCommunityIcons
                        name="check-all"
                        size={12}
                        color={activeShipment.currentStep >= 5 ? colors.white : '#94A3B8'}
                      />
                    </View>
                    <Text style={[styles.stepLabel, activeShipment.currentStep >= 5 && styles.stepLabelActive]}>
                      {t('profile.stepDelivered')}
                    </Text>
                  </View>
                </View>

                {/* COD Amount Banner */}
                {activeShipment.codAmount > 0 && (
                  <View style={styles.codAlertBanner}>
                    <MaterialCommunityIcons name="cash-multiple" size={20} color="#EA580C" />
                    <View style={tw`ml-2.5 flex-1`}>
                      <Text style={styles.codAlertTitle}>{t('profile.codAmountNeeded')}</Text>
                      <Text style={styles.codAlertAmount}>{formatCurrency(activeShipment.codAmount)}</Text>
                    </View>
                  </View>
                )}

                {/* Action Link to Orders */}
                <TouchableOpacity
                  style={styles.trackDetailsBtn}
                  onPress={() => navigation?.navigate('MyOrders')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.trackDetailsBtnText}>{t('profile.trackDetails')}</Text>
                  <MaterialCommunityIcons name={isRTL ? "chevron-left" : "chevron-right"} size={20} color={colors.accent} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* ─── 4. Quick Services & Management Grid ─── */}
        <Text style={[tw`font-bold text-base mt-4 mb-2.5 px-1`, { color: colors.textPrimary, textAlign: isRTL ? 'right' : 'left' }]}>
          {t('profile.servicesSettings')}
        </Text>

        {/* 1. Address Book Manager */}
        <View style={[styles.serviceCard, cardShadow]}>
          <View style={tw`flex-row items-center justify-between mb-3`}>
            <View style={tw`flex-row items-center`}>
              <View style={[styles.serviceIconWrap, { backgroundColor: '#EFF6FF' }]}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={22} color="#2563EB" />
              </View>
              <View style={isRTL ? tw`mr-2.5` : tw`ml-2.5`}>
                <Text style={styles.serviceTitle}>{t('profile.egyptianAddressBook')}</Text>
                <Text style={styles.serviceSubtitle}>
                  {t('profile.addressesCount', { count: addresses.length })}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() => openAddressModal()}
              style={styles.addSmallBtn}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
              <Text style={styles.addSmallBtnText}>{t('profile.addAddress')}</Text>
            </TouchableOpacity>
          </View>

          {addresses.length === 0 ? (
            <Text style={[tw`text-xs py-2`, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('profile.noAddresses')}
            </Text>
          ) : (
            addresses.slice(0, 3).map((addr) => (
              <View key={`addr-tile-${addr.id}`} style={styles.addressItemRow}>
                <View style={tw`flex-1 mr-2`}>
                  <View style={tw`flex-row items-center`}>
                    <Text style={[tw`font-bold text-xs`, { color: colors.textPrimary }]}>
                      {addr.label || t('profile.defaultDelivery')}
                    </Text>
                    {addr.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>{t('profile.defaultBadge')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[tw`text-[11px] mt-0.5`, { color: colors.textSecondary }]} numberOfLines={1}>
                    {addr.governorate}، {addr.city}، {addr.streetBuilding}
                  </Text>
                </View>

                <View style={tw`flex-row items-center`}>
                  <TouchableOpacity onPress={() => openAddressModal(addr)} style={tw`p-1 mr-1`}>
                    <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteAddress(addr.id)} style={tw`p-1`}>
                    <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.discount} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* 2. Egyptian PDPL 151/2020 Privacy & Security Center */}
        <View style={[styles.serviceCard, cardShadow, tw`mt-3`]}>
          <View style={tw`flex-row items-center mb-2.5`}>
            <View style={[styles.serviceIconWrap, { backgroundColor: '#F0FDF4' }]}>
              <MaterialCommunityIcons name="shield-check-outline" size={22} color="#16A34A" />
            </View>
            <View style={[isRTL ? tw`mr-2.5` : tw`ml-2.5`, tw`flex-1`]}>
              <Text style={styles.serviceTitle}>{t('profile.privacyCenter')}</Text>
              <Text style={styles.serviceSubtitle}>
                {t('profile.dataPrivacySubtitle')}
              </Text>
            </View>
          </View>

          {/* 1-Click JSON Export */}
          <TouchableOpacity
            style={styles.pdplActionRow}
            onPress={handleExportData}
            disabled={exportingData}
            activeOpacity={0.75}
          >
            <View style={tw`flex-row items-center flex-1`}>
              <MaterialCommunityIcons name="file-download-outline" size={20} color={colors.primary} />
              <View style={[isRTL ? tw`mr-2.5` : tw`ml-2.5`, tw`flex-1`]}>
                <Text style={styles.pdplRowTitle}>{t('profile.exportJson')}</Text>
                <Text style={styles.pdplRowSub}>{t('profile.exportJsonSub')}</Text>
              </View>
            </View>
            {exportingData ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <MaterialCommunityIcons name={isRTL ? "chevron-left" : "chevron-right"} size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>

          <View style={styles.pdplDivider} />

          {/* Account Erasure */}
          <TouchableOpacity
            style={styles.pdplActionRow}
            onPress={() => setDeleteAccountModalVisible(true)}
            activeOpacity={0.75}
          >
            <View style={tw`flex-row items-center flex-1`}>
              <MaterialCommunityIcons name="account-remove-outline" size={20} color="#DC2626" />
              <View style={[isRTL ? tw`mr-2.5` : tw`ml-2.5`, tw`flex-1`]}>
                <Text style={[styles.pdplRowTitle, { color: '#DC2626' }]}>
                  {t('profile.deleteAccountTitle')}
                </Text>
                <Text style={styles.pdplRowSub}>{t('profile.deleteAccountSub')}</Text>
              </View>
            </View>
            <MaterialCommunityIcons name={isRTL ? "chevron-left" : "chevron-right"} size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* 3. Seller Dispatch Settings (Only if Seller) */}
        {!isBuyer && (
          <View style={[styles.serviceCard, cardShadow, tw`mt-3`]}>
            <View style={tw`flex-row items-center mb-3`}>
              <View style={[styles.serviceIconWrap, { backgroundColor: '#FFF7ED' }]}>
                <MaterialCommunityIcons name="store-outline" size={22} color={colors.accent} />
              </View>
              <Text style={[styles.serviceTitle, isRTL ? tw`mr-2.5` : tw`ml-2.5`]}>{t('profile.sellerDispatchSettings')}</Text>
            </View>

            {loadingSellerProfile ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <View>
                <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.mainDispatchCity')}</Text>
                <TextInput
                  style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                  value={sellerProfile.dispatchCity}
                  onChangeText={(text) => setSellerProfile((p) => ({ ...p, dispatchCity: text }))}
                  placeholder={isRTL ? 'مثال: القاهرة' : 'e.g. Cairo'}
                  placeholderTextColor="#94A3B8"
                />

                <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.detailedDispatchAddress')}</Text>
                <TextInput
                  style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                  value={sellerProfile.dispatchAddress}
                  onChangeText={(text) => setSellerProfile((p) => ({ ...p, dispatchAddress: text }))}
                  placeholder={isRTL ? 'الشارع والحي ورقم المبنى' : 'Street, district & building'}
                  placeholderTextColor="#94A3B8"
                />

                <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.contactPhoneRepresentative')}</Text>
                <TextInput
                  style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                  keyboardType="phone-pad"
                  value={sellerProfile.contactPhone}
                  onChangeText={(text) => setSellerProfile((p) => ({ ...p, contactPhone: text }))}
                  placeholder="010xxxxxxxx"
                  placeholderTextColor="#94A3B8"
                />

                <TouchableOpacity
                  onPress={handleSaveSellerProfile}
                  disabled={savingSellerProfile}
                  style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                >
                  {savingSellerProfile ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.saveBtnText}>{t('profile.saveSellerSettings')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* 4. Password & Biometric Security Accordion */}
        <View style={[styles.serviceCard, cardShadow, tw`mt-3`]}>
          {/* Biometrics Toggle / Unavailable Notice */}
          <View style={tw`mb-3 pb-3 border-b border-gray-100`}>
            <View style={tw`flex-row items-center mb-2.5`}>
              <View style={[styles.serviceIconWrap, { backgroundColor: '#F1F5F9' }]}>
                <MaterialCommunityIcons name="shield-lock-outline" size={22} color={colors.primary} />
              </View>
              <Text style={[styles.serviceTitle, isRTL ? tw`mr-2.5` : tw`ml-2.5`]}>
                {t('biometrics.securitySection', 'الأمان والدخول البيومتري')}
              </Text>
            </View>

            {biometricSupport.available ? (
              <View style={tw`flex-row items-center justify-between py-1`}>
                <View style={tw`flex-1 ${isRTL ? 'ml-3' : 'mr-3'}`}>
                  <Text style={[styles.fieldLabel, { marginBottom: 2, textAlign: isRTL ? 'right' : 'left' }]}>
                    {t('biometrics.biometricToggleTitle', 'تسجيل الدخول بالبصمة')}
                  </Text>
                  <Text style={[tw`text-xs text-gray-500`, { textAlign: isRTL ? 'right' : 'left' }]}>
                    {t('biometrics.biometricToggleSubtitle', 'استخدم بصمة الإصبع أو الوجه لفتح التطبيق وتسجيل الدخول')}
                  </Text>
                </View>
                <Switch
                  value={biometricsEnabled}
                  onValueChange={handleToggleBiometrics}
                  trackColor={{ false: '#CBD5E1', true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ) : (
              <View style={tw`p-2.5 bg-gray-50 rounded-lg flex-row items-center`}>
                <MaterialCommunityIcons name="fingerprint-off" size={20} color="#94A3B8" />
                <Text style={[tw`text-xs text-gray-500 flex-1`, isRTL ? tw`mr-2` : tw`ml-2`, { textAlign: isRTL ? 'right' : 'left' }]}>
                  {t(biometricSupport.messageKey || 'biometrics.hardwareUnavailable')}
                </Text>
              </View>
            )}
          </View>

          {/* Change Password Accordion Header */}
          <TouchableOpacity
            style={tw`flex-row items-center justify-between`}
            onPress={() => setIsChangingPassword((p) => !p)}
            activeOpacity={0.8}
          >
            <View style={tw`flex-row items-center`}>
              <View style={[styles.serviceIconWrap, { backgroundColor: '#F8FAFC' }]}>
                <MaterialCommunityIcons name="lock-outline" size={20} color={colors.primary} />
              </View>
              <Text style={[styles.serviceTitle, isRTL ? tw`mr-2.5` : tw`ml-2.5`]}>{t('profile.changePassword')}</Text>
            </View>
            <MaterialCommunityIcons
              name={isChangingPassword ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          {isChangingPassword && (
            <View style={tw`mt-3 pt-3 border-t border-gray-100`}>
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.currentPassword')} *</Text>
              <TextInput
                secureTextEntry
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.newPassword')} *</Text>
              <TextInput
                secureTextEntry
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.confirmNewPassword')} *</Text>
              <TextInput
                secureTextEntry
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                onPress={handleSavePassword}
                disabled={savingPassword}
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              >
                {savingPassword ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('profile.updatePassword')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 5. Language Switcher (Arabic RTL / English LTR) */}
        <View style={[styles.serviceCard, cardShadow, tw`mt-3`]}>
          <View style={tw`flex-row items-center mb-3`}>
            <View style={[styles.serviceIconWrap, { backgroundColor: '#F3E8FF' }]}>
              <MaterialCommunityIcons name="translate" size={22} color="#7C3AED" />
            </View>
            <Text style={[styles.serviceTitle, isRTL ? tw`mr-2.5` : tw`ml-2.5`]}>{t('profile.appLanguageAndDir')}</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <TouchableOpacity
              onPress={() => handleLanguageChange('ar')}
              style={[
                styles.langBtn,
                isArabicActive ? styles.langBtnActive : styles.langBtnInactive,
              ]}
              activeOpacity={0.8}
            >
              <Text style={[styles.langBtnText, isArabicActive && styles.langBtnTextActive]}>
                العربية (RTL) 🇪🇬
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleLanguageChange('en')}
              style={[
                styles.langBtn,
                !isArabicActive ? styles.langBtnActive : styles.langBtnInactive,
              ]}
              activeOpacity={0.8}
            >
              <Text style={[styles.langBtnText, !isArabicActive && styles.langBtnTextActive]}>
                English (LTR)
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 6. Logout Button */}
        <TouchableOpacity
          style={[styles.logoutBtn, cardShadow, tw`mt-4`]}
          onPress={handleLogout}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="logout" size={20} color="#DC2626" />
          <Text style={[styles.logoutBtnText, isRTL ? tw`mr-2` : tw`ml-2`]}>{t('profile.logoutAccount')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ─── Address Modal (4 Egyptian Fields) ─── */}
      <Modal
        visible={addressModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddressModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, cardShadow]}>
            <View style={tw`flex-row items-center justify-between pb-3 border-b border-gray-100`}>
              <Text style={styles.modalTitle}>
                {editingAddressId ? t('profile.addressModal.titleEdit') : t('profile.addressModal.titleNew')}
              </Text>
              <TouchableOpacity onPress={() => setAddressModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={tw`mt-3`}>
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.label')}</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.label}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, label: text }))}
                placeholder={isRTL ? 'مثال: المنزل' : 'e.g. Home'}
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.recipientName')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.recipientName}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, recipientName: text }))}
                placeholder={isRTL ? 'الاسم الكامل كما بالبطاقة' : 'Full Name'}
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.recipientPhone')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                keyboardType="phone-pad"
                value={addressForm.recipientPhone}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, recipientPhone: text }))}
                placeholder="010xxxxxxxx"
                placeholderTextColor="#94A3B8"
              />

              {/* 1. Governorate */}
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.governorate')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.governorate}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, governorate: text }))}
                placeholder={isRTL ? 'القاهرة، الإسكندرية، الجيزة...' : 'Cairo, Alexandria, Giza...'}
                placeholderTextColor="#94A3B8"
              />

              {/* 2. City / Center */}
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.city')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.city}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, city: text }))}
                placeholder={isRTL ? 'مدينة نصر، المعادي، الدقي...' : 'Nasr City, Maadi, Dokki...'}
                placeholderTextColor="#94A3B8"
              />

              {/* 3. Area / District */}
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.area')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.area}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, area: text }))}
                placeholder={isRTL ? 'الحي السابع، الزهراء...' : '7th District, Zahraa...'}
                placeholderTextColor="#94A3B8"
              />

              {/* 4. Street & Building / Apartment */}
              <Text style={[styles.fieldLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.addressModal.streetBuilding')} *</Text>
              <TextInput
                style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
                value={addressForm.streetBuilding}
                onChangeText={(text) => setAddressForm((p) => ({ ...p, streetBuilding: text }))}
                placeholder={isRTL ? 'اسم الشارع، رقم العمارة، الدور، رقم الشقة' : 'Street name, building, floor, apt'}
                placeholderTextColor="#94A3B8"
              />

              <View style={tw`flex-row items-center justify-between py-2 mb-4`}>
                <Text style={[tw`text-sm font-semibold`, { color: colors.textPrimary }]}>
                  {t('profile.addressModal.isDefault')}
                </Text>
                <Switch
                  value={addressForm.isDefault}
                  onValueChange={(val) => setAddressForm((p) => ({ ...p, isDefault: val }))}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>

              <TouchableOpacity
                onPress={handleSaveAddress}
                disabled={savingAddress}
                style={[styles.saveBtn, { backgroundColor: colors.primary, marginBottom: 20 }]}
              >
                {savingAddress ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ─── Delete Account Confirmation Modal (PDPL 151/2020) ─── */}
      <Modal
        visible={deleteAccountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteAccountModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.deleteModalBox, cardShadow]}>
            <View style={styles.deleteIconBox}>
              <MaterialCommunityIcons name="alert-octagon" size={32} color="#DC2626" />
            </View>

            <Text style={styles.deleteModalTitle}>{t('profile.deleteAccountTitle')}</Text>
            <Text style={styles.deleteModalDesc}>
              {t('profile.deleteWarning')}
            </Text>

            <Text style={[styles.fieldLabel, tw`mt-3`, { textAlign: isRTL ? 'right' : 'left' }]}>{t('profile.deleteConfirmText')}</Text>
            <TextInput
              secureTextEntry
              style={[styles.fieldInput, { textAlign: isRTL ? 'right' : 'left' }]}
              value={deletePasswordInput}
              onChangeText={setDeletePasswordInput}
              placeholder={isRTL ? 'أدخل كلمة المرور الحالية' : 'Enter current password'}
              placeholderTextColor="#94A3B8"
            />

            <View style={tw`flex-row justify-end mt-4`}>
              <TouchableOpacity
                onPress={() => setDeleteAccountModalVisible(false)}
                style={[styles.nameCancelBtn, isRTL ? tw`ml-2` : tw`mr-2`]}
              >
                <Text style={styles.nameCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDeleteAccountConfirm}
                disabled={deletingAccount}
                style={[styles.saveBtn, { backgroundColor: '#DC2626', minWidth: 100 }]}
              >
                {deletingAccount ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>{t('common.delete')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Buyer Wallet Transactions History Modal ─── */}
      <Modal
        visible={showWalletModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWalletModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={tw`flex-row justify-between items-center mb-4 pb-3 border-b border-gray-100`}>
              <View style={tw`flex-row items-center`}>
                <MaterialCommunityIcons name="wallet" size={24} color={colors.accent} />
                <Text style={[styles.modalTitle, isRTL ? tw`mr-2` : tw`ml-2`]}>
                  {t('profile.walletTxModalTitle')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowWalletModal(false)}>
                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Current Balance Banner */}
            <View
              style={[
                tw`p-4 rounded-2xl mb-4 border flex-row items-center justify-between`,
                { backgroundColor: '#FFF7ED', borderColor: colors.accent },
              ]}
            >
              <Text style={[tw`font-bold text-sm`, { color: colors.textPrimary }]}>{t('profile.availableBalanceLabel')}</Text>
              <Text style={[tw`font-black text-2xl`, { color: colors.accent }]}>
                {formatCurrency(walletData?.balance || 0)}
              </Text>
            </View>

            <Text style={[tw`font-bold text-xs mb-2`, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>
              {t('profile.previousTxLabel', { count: walletData?.transactions?.length || 0 })}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {!walletData?.transactions || walletData.transactions.length === 0 ? (
                <View style={tw`py-8 items-center justify-center`}>
                  <MaterialCommunityIcons name="history" size={36} color={colors.textSecondary} />
                  <Text style={[tw`text-xs mt-2`, { color: colors.textSecondary }]}>
                    {t('profile.noPreviousTx')}
                  </Text>
                </View>
              ) : (
                walletData.transactions.map((tx, idx) => {
                  const isCredit = tx.amount > 0;
                  return (
                    <View
                      key={`wallet-tx-${tx.id || idx}`}
                      style={[
                        tw`p-3 rounded-xl border mb-2 flex-row items-center justify-between`,
                        { borderColor: colors.border, backgroundColor: colors.screenBg },
                      ]}
                    >
                      <View style={tw`flex-row items-center flex-1`}>
                        <View
                          style={[
                            tw`w-8 h-8 rounded-full items-center justify-center ${isRTL ? 'ml-2.5' : 'mr-2.5'}`,
                            { backgroundColor: isCredit ? colors.newBadgeSoft : colors.primarySoft },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={isCredit ? 'arrow-down-left' : 'arrow-up-right'}
                            size={18}
                            color={isCredit ? colors.newBadge : colors.primary}
                          />
                        </View>
                        <View style={tw`flex-1`}>
                          <Text style={[tw`font-bold text-xs`, { color: colors.textPrimary }]}>
                            {tx.type === 'RefundCredit'
                              ? t('profile.refundCredit')
                              : tx.type === 'OrderRedemption'
                              ? t('profile.orderRedemption')
                              : tx.type || t('profile.balanceTx')}
                          </Text>
                          <Text style={[tw`text-[10px] mt-0.5`, { color: colors.textSecondary }]}>
                            {tx.description || formatDate(tx.createdAt)}
                          </Text>
                        </View>
                      </View>

                      <Text
                        style={[
                          tw`font-bold text-sm`,
                          { color: isCredit ? colors.newBadge : colors.discount },
                        ]}
                      >
                        {isCredit ? `+${formatCurrency(tx.amount)}` : formatCurrency(tx.amount)}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 54 : 44,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  avatarText: {
    color: colors.white,
    fontWeight: '900',
    fontSize: 18,
  },
  userNameText: {
    color: colors.white,
    fontWeight: '800',
    fontSize: 17,
  },
  userEmailText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 1,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    marginLeft: 6,
  },
  trustBadgeText: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 2,
  },
  editProfileBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameEditBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  nameTextInput: {
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  nameCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginRight: 8,
  },
  nameCancelText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  nameSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  nameSaveText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignSelf: 'center',
  },
  summaryNumber: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.white,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  summaryStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  scrollContainer: {
    padding: 14,
    paddingBottom: 36,
  },
  orderStatusBarCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  statusTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  badgeCount: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: colors.accent,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
  },
  statusTileLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  activeShipmentCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#EA580C',
    marginBottom: 12,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EA580C',
  },
  carrierTag: {
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  carrierTagText: {
    color: '#EA580C',
    fontSize: 10,
    fontWeight: '800',
  },
  stepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginVertical: 14,
    position: 'relative',
  },
  stepperLine: {
    position: 'absolute',
    top: 11,
    left: 20,
    right: 20,
    height: 3,
    backgroundColor: '#E2E8F0',
    zIndex: 1,
  },
  stepperProgress: {
    position: 'absolute',
    top: 11,
    left: 20,
    height: 3,
    backgroundColor: '#16A34A',
    zIndex: 2,
  },
  stepNodeWrap: {
    alignItems: 'center',
    zIndex: 3,
    width: 60,
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepCircleActive: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  stepLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#94A3B8',
    textAlign: 'center',
  },
  stepLabelActive: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  codAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
    marginTop: 4,
  },
  codAlertTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9A3412',
  },
  codAlertAmount: {
    fontSize: 14,
    fontWeight: '900',
    color: '#EA580C',
  },
  trackDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 6,
  },
  trackDetailsBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.accent,
  },
  serviceCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  serviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  serviceSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  addSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  addSmallBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: 2,
  },
  addressItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  defaultBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  defaultBadgeText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
  },
  pdplActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  pdplDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  pdplRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pdplRowSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
    marginTop: 6,
  },
  fieldInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  saveBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  saveBtnText: {
    color: colors.white,
    fontWeight: '800',
    fontSize: 13,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginHorizontal: 4,
  },
  langBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langBtnInactive: {
    backgroundColor: colors.screenBg,
    borderColor: colors.border,
  },
  langBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  langBtnTextActive: {
    color: colors.white,
    fontWeight: '800',
  },
  logoutBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: 14,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  deleteModalBox: {
    width: '90%',
    backgroundColor: colors.cardBg,
    borderRadius: 20,
    padding: 20,
    alignSelf: 'center',
    marginBottom: 'auto',
    marginTop: 'auto',
  },
  deleteIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 10,
  },
  deleteModalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#DC2626',
    textAlign: 'center',
  },
  deleteModalDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});
