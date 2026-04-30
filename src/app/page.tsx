"use client"

import { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { MainApp } from '@/components/MainApp';

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Initial check for stored name
    const storedName = localStorage.getItem('kanka_voice_user');
    if (storedName) {
      setUserName(storedName);
    }
    setIsHydrated(true);
  }, []);

  const handleLogin = (name: string) => {
    localStorage.setItem('kanka_voice_user', name);
    setUserName(name);
  };

  const handleLogout = () => {
    localStorage.removeItem('kanka_voice_user');
    setUserName(null);
  };

  // Prevent hydration mismatch
  if (!isHydrated) return null;

  if (!userName) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <MainApp userName={userName} onLogout={handleLogout} />;
}
