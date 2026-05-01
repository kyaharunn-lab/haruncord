"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { AudioSettings } from "@/lib/webrtc";

interface AudioSettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AudioSettings & { outputDeviceId?: string };
  onSettingsChange: (settings: AudioSettings & { outputDeviceId?: string }) => void;
}

export function AudioSettingsDialog({
  isOpen,
  onOpenChange,
  settings,
  onSettingsChange,
}: AudioSettingsDialogProps) {
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        setMicrophones(devices.filter((d) => d.kind === "audioinput"));
        setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
      } catch (err) {
        console.error("Cihaz listesi alınamadı:", err);
      }
    };

    if (isOpen) {
      fetchDevices();
    }
  }, [isOpen]);

  const updateSetting = (key: keyof (AudioSettings & { outputDeviceId?: string }), value: any) => {
    const newSettings = { ...settings, [key]: value };
    onSettingsChange(newSettings);
    localStorage.setItem("kanka_audio_settings", JSON.stringify(newSettings));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Ses Ayarları</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Cihaz Seçimi */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Mikrofon</Label>
              <Select
                value={settings.deviceId || "default"}
                onValueChange={(val) => updateSetting("deviceId", val)}
              >
                <SelectTrigger className="w-full bg-background border-border">
                  <SelectValue placeholder="Mikrofon seçin" />
                </SelectTrigger>
                <SelectContent>
                  {microphones.map((mic) => (
                    <SelectItem key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || "Bilinmeyen Mikrofon"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Hoparlör / Çıkış</Label>
              <Select
                value={settings.outputDeviceId || "default"}
                onValueChange={(val) => updateSetting("outputDeviceId", val)}
              >
                <SelectTrigger className="w-full bg-background border-border">
                  <SelectValue placeholder="Çıkış cihazı seçin" />
                </SelectTrigger>
                <SelectContent>
                  {speakers.map((spk) => (
                    <SelectItem key={spk.deviceId} value={spk.deviceId}>
                      {spk.label || "Bilinmeyen Hoparlör"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="h-px bg-border my-2" />

          {/* Noise Gate Hassasiyeti */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-semibold">Mikrofon Hassasiyeti (Noise Gate)</Label>
              <span className="text-xs text-muted-foreground">%{Math.round((settings.micSensitivity ?? 0.03) * 100)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Konuşmadığınızda sesin tamamen kesilmesi için gereken eşik seviyesi.</p>
            <Slider
              value={[(settings.micSensitivity ?? 0.03) * 100]}
              max={100}
              step={1}
              onValueChange={(val) => updateSetting("micSensitivity", val[0] / 100)}
              className="py-2"
            />
          </div>

          <div className="h-px bg-border my-2" />

          {/* Ses İşleme Ayarları */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Yankı Önleme</Label>
                <p className="text-xs text-muted-foreground">Hoparlörden gelen sesi engeller.</p>
              </div>
              <Switch
                checked={settings.echoCancellation}
                onCheckedChange={(val) => updateSetting("echoCancellation", val)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Gürültü Azaltma (Donanımsal)</Label>
                <p className="text-xs text-muted-foreground">Arka plan seslerini temizler.</p>
              </div>
              <Switch
                checked={settings.noiseSuppression}
                onCheckedChange={(val) => updateSetting("noiseSuppression", val)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Otomatik Kazanç (AGC)</Label>
                <p className="text-xs text-muted-foreground">Ses seviyenizi dengeler.</p>
              </div>
              <Switch
                checked={settings.autoGainControl}
                onCheckedChange={(val) => updateSetting("autoGainControl", val)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
