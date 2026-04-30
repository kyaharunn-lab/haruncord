"use client"

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Headphones } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (name: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onLogin(name.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-none shadow-2xl bg-card">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto bg-primary w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
            <Headphones className="text-primary-foreground w-10 h-10" />
          </div>
          <div>
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground font-headline">Kanka Voice</CardTitle>
            <p className="text-muted-foreground mt-2">Sohbete katılmak için bir isim seç.</p>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">İsmin</Label>
              <Input
                id="name"
                placeholder="İsmini yaz"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="bg-background border-border focus:ring-primary h-12"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="pb-8">
            <Button 
              type="submit" 
              className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90 transition-all shadow-md active:scale-[0.98]"
            >
              Sohbete Katıl
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
