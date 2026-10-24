import React, { useContext } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { AuthContext } from '../context/AuthContext';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import VerifyScreen from '../screens/auth/VerifyScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';

import BuyerTabs from './BuyerTabs';
import SellerTabs from './SellerTabs';
import AddEditProductScreen from '../screens/seller/AddEditProductScreen';
import ProductDetailsScreen from '../screens/buyer/ProductDetailsScreen';
import CheckoutScreen from '../screens/buyer/CheckoutScreen';

import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { userRole, isLoading } = useContext(AuthContext);
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F172A' }}>
        <ActivityIndicator size="large" color="#FF8C33" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          headerStyle: {
            backgroundColor: colors.primary,
          },
          headerTintColor: colors.white,
          headerTitleStyle: {
            fontWeight: '800',
            fontSize: 18,
          },
          contentStyle: {
            backgroundColor: colors.screenBg,
          },
        }}
      >
        {userRole == null ? (
          // No token -> Auth Stack
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="Verify" component={VerifyScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        ) : userRole === 'Seller' ? (
          // Role = Seller
          <Stack.Group>
            <Stack.Screen name="SellerRoot" component={SellerTabs} />
            <Stack.Screen
              name="AddEditProduct"
              component={AddEditProductScreen}
              options={{ presentation: 'modal', headerShown: true, title: '' }}
            />
          </Stack.Group>
        ) : (
          // Default to Buyer
          <Stack.Group>
            <Stack.Screen name="BuyerRoot" component={BuyerTabs} />
            <Stack.Screen
              name="ProductDetails"
              component={ProductDetailsScreen}
              options={{
                headerShown: true,
                title: t('buyer.productDetails'),
              }}
            />
            <Stack.Screen
              name="Checkout"
              component={CheckoutScreen}
              options={{
                headerShown: true,
                title: t('buyer.checkout'),
              }}
            />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
