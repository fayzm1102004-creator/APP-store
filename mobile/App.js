import React, { useContext } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/locales/i18n'; // Initialize i18next
import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import AppNavigator from './src/navigation/AppNavigator';
import UnlockScreen from './src/screens/auth/UnlockScreen';
import ErrorBoundary from './src/components/ErrorBoundary';

function AppContent() {
  const { isLocked, userName, userEmail, unlockWithBiometrics, unlockWithPassword } = useContext(AuthContext);

  if (isLocked) {
    return (
      <UnlockScreen
        userName={userName}
        userEmail={userEmail}
        onUnlockSuccess={unlockWithBiometrics}
        onUsePassword={unlockWithPassword}
      />
    );
  }

  return <AppNavigator />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider style={styles.root}>
        <AuthProvider>
          <CartProvider>
            <AppContent />
          </CartProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
