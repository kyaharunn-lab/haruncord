/**
 * WebRTC yardımcı fonksiyonları.
 * Bu dosya temel bağlantı ve medya yönetimi işlemlerini içerir.
 */

export type AudioQualityMode = 'low-latency' | 'balanced' | 'high-quality';

export interface AudioSettings {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micSensitivity: number; // 0.0 - 1.0 (Hassasiyet eşiği)
  gateLevel: number;      // 0.0 - 1.0 (Gürültü kapısı agresifliği)
  gateSmoothing: number;  // 0.0 - 1.0 (Kapanış hızı/yumuşatma)
  micGain: number;       // 1.0 - 4.0 (Yazılımsal kazanç)
  qualityMode?: AudioQualityMode;
}

const processedStreamCleanups = new WeakMap<MediaStream, () => void>();

/**
 * Ham ses akışını Web Audio API ile işleyerek gelişmiş gürültü engelleme, 
 * kazanç ve ayarlanabilir gürültü kapısı uygular.
 */
export const processAudioStream = (stream: MediaStream, settings: AudioSettings): MediaStream => {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("AudioContext desteklenmiyor");
    }
    const audioContext = new AudioContextCtor({
      latencyHint: settings.qualityMode === 'low-latency' ? 'interactive' : 'playback',
      sampleRate: 48000,
    });

    const source = audioContext.createMediaStreamSource(stream);
    const destination = audioContext.createMediaStreamDestination();

    // 1. Pre-Gain Node
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(settings.micGain ?? 1.0, audioContext.currentTime);

    // 2. High-pass Filter: Düşük frekanslı gürültüleri (fan, motor) temizler.
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(settings.qualityMode === 'high-quality' ? 120 : 150, audioContext.currentTime);
    highPass.Q.setValueAtTime(0.7, audioContext.currentTime);

    // 3. Peaking Filter (Voice Clarity): İnsan sesi frekanslarını hafifçe öne çıkarır (High Quality modunda).
    const clarityFilter = audioContext.createBiquadFilter();
    clarityFilter.type = 'peaking';
    clarityFilter.frequency.setValueAtTime(3000, audioContext.currentTime);
    clarityFilter.gain.setValueAtTime(settings.qualityMode === 'high-quality' ? 3 : 0, audioContext.currentTime);
    clarityFilter.Q.setValueAtTime(1.0, audioContext.currentTime);

    // 4. Dynamics Compressor: Ses seviyesini dengeler, patlamaları önler.
    const compressor = audioContext.createDynamicsCompressor();
    if (settings.qualityMode === 'high-quality') {
      compressor.threshold.setValueAtTime(-20, audioContext.currentTime);
      compressor.knee.setValueAtTime(20, audioContext.currentTime);
      compressor.ratio.setValueAtTime(8, audioContext.currentTime);
      compressor.attack.setValueAtTime(0.002, audioContext.currentTime);
      compressor.release.setValueAtTime(0.2, audioContext.currentTime);
    } else {
      compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
      compressor.knee.setValueAtTime(30, audioContext.currentTime);
      compressor.ratio.setValueAtTime(12, audioContext.currentTime);
      compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
      compressor.release.setValueAtTime(0.25, audioContext.currentTime);
    }

    // 5. Noise Gate Kontrol Ünitesi
    const gateGain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = settings.qualityMode === 'low-latency' ? 256 : 512;
    
    // İşleme zinciri: Source -> Gain -> HighPass -> Clarity -> Compressor -> Analyser -> GateGain -> Destination
    source.connect(gainNode);
    gainNode.connect(highPass);
    highPass.connect(clarityFilter);
    clarityFilter.connect(compressor);
    compressor.connect(analyser);
    compressor.connect(gateGain);
    gateGain.connect(destination);

    const dataArray = new Float32Array(analyser.fftSize);
    let isOpen = false;
    let lastHighVolumeTime = 0;
    let consecutiveHighVolumeFrames = 0;
    
    const threshold = 0.01 + (settings.micSensitivity * 0.2 * (settings.gateLevel ?? 1.0));
    const releaseTime = 0.1 + ((settings.gateSmoothing ?? 0.5) * 0.9);

    const updateGate = () => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(dataArray);
      
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      const now = audioContext.currentTime;

      if (rms > threshold) {
        consecutiveHighVolumeFrames++;
        if (consecutiveHighVolumeFrames >= 2) { 
          if (!isOpen) {
            gateGain.gain.setTargetAtTime(1, now, 0.003); // Hızlı attack
            isOpen = true;
          }
          lastHighVolumeTime = now;
        }
      } else {
        consecutiveHighVolumeFrames = 0;
        if (isOpen && (now - lastHighVolumeTime) > releaseTime) {
          gateGain.gain.setTargetAtTime(0, now, 0.05); // Yumuşak release
          isOpen = false;
        }
      }
    };

    const intervalRate = settings.qualityMode === 'low-latency' ? 10 : 20;
    const gateInterval = setInterval(updateGate, intervalRate);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(gateInterval);
      stream.getTracks().forEach((track) => track.stop());
      if (audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };

    stream.getTracks().forEach((track) => track.addEventListener('ended', cleanup, { once: true }));
    destination.stream.getTracks().forEach((track) => track.addEventListener('ended', cleanup, { once: true }));
    processedStreamCleanups.set(destination.stream, cleanup);

    return destination.stream;
  } catch (error) {
    console.error("Gelişmiş ses işleme hatası (Raw Mic'e dönülüyor):", error);
    console.log("raw microphone fallback kullanıldı");
    return stream;
  }
};

export const getLocalAudioStream = async (settings?: AudioSettings): Promise<MediaStream | null> => {
  try {
    const audioConstraints: MediaTrackConstraints = {
      deviceId: settings?.deviceId && settings.deviceId !== "default" ? { exact: settings.deviceId } : undefined,
      echoCancellation: settings?.echoCancellation ?? true,
      noiseSuppression: settings?.noiseSuppression ?? true,
      autoGainControl: settings?.autoGainControl ?? true,
      sampleRate: 48000,
      channelCount: 1,
    };

    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    console.log("mikrofon alındı");
    
    if (rawStream && settings) {
      try {
        const processed = processAudioStream(rawStream, settings);
        console.log("✨ Ses filtreleri uygulandı");
        return processed;
      } catch (e) {
        console.warn("⚠️ İşlenmiş stream oluşturulamadı, ham ses kullanılıyor");
        console.log("raw microphone fallback kullanıldı");
        return rawStream;
      }
    }

    return rawStream;
  } catch (error) {
    console.error("Mikrofon erişimi sırasında hata oluştu:", error);
    return null;
  }
};

export const createPeerConnection = (): RTCPeerConnection | null => {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 10,
    });
    console.log("🔗 PeerConnection oluşturuldu");
    return pc;
  } catch (error) {
    console.error("PeerConnection oluşturulurken hata oluştu:", error);
    return null;
  }
};

export const addLocalTracks = (
  pc: RTCPeerConnection,
  stream: MediaStream
): void => {
  try {
    stream.getTracks().forEach((track) => {
      const senders = pc.getSenders();
      const alreadyAdded = senders.some((sender) => sender.track && (sender.track.id === track.id || sender.track.kind === track.kind));
      if (!alreadyAdded) {
        pc.addTrack(track, stream);
        console.log(`track eklendi: ${track.kind}`);
      }
    });
  } catch (error) {
    console.error("Yerel track eklenirken hata oluştu:", error);
  }
};

export const createOffer = async (
  pc: RTCPeerConnection,
  options: RTCOfferOptions = {}
): Promise<RTCSessionDescriptionInit | null> => {
  try {
    if (pc.signalingState !== "stable") return null;
    const offer = await pc.createOffer({ offerToReceiveAudio: true, ...options });
    await pc.setLocalDescription(offer);
    console.log("offer yazıldı");
    return offer;
  } catch (error) {
    console.error("Offer oluşturulurken hata oluştu:", error);
    return null;
  }
};

export const createAnswer = async (
  pc: RTCPeerConnection,
  offer: RTCSessionDescriptionInit
): Promise<RTCSessionDescriptionInit | null> => {
  try {
    if (pc.signalingState !== "stable") return null;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log("offer alındı");
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log("answer yazıldı");
    return answer;
  } catch (error) {
    console.error("Answer oluşturulurken hata oluştu:", error);
    return null;
  }
};

export const applyRemoteDescription = async (
  pc: RTCPeerConnection,
  desc: RTCSessionDescriptionInit
): Promise<void> => {
  try {
    if (pc.signalingState === "closed") return;
    if (desc.type === "answer" && pc.signalingState !== "have-local-offer") return;
    if (desc.type === "offer" && pc.signalingState !== "stable") return;
    await pc.setRemoteDescription(new RTCSessionDescription(desc));
    console.log(`${desc.type} alındı`);
  } catch (error) {
    console.error("Remote description ayarlanırken hata oluştu:", error);
  }
};

export const setRemoteDescription = applyRemoteDescription;

export const addIceCandidate = async (
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit | null
): Promise<void> => {
  try {
    if (!candidate || pc.signalingState === "closed") return;
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    console.log("ICE alındı");
  } catch (error) {
    console.warn("⚠️ ICE candidate eklenemedi:", error);
  }
};

export const closePeerConnection = (pc: RTCPeerConnection | null): void => {
  if (!pc) return;
  try {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.getSenders().forEach((sender) => {
      try {
        pc.removeTrack(sender);
      } catch (error) {
        // Sender may already be detached during browser-side teardown.
      }
    });
    pc.close();
    console.log("🔌 PeerConnection kapatıldı");
  } catch (error) {
    console.error("Bağlantı kapatılırken hata oluştu:", error);
  }
};

export const stopMediaStream = (stream: MediaStream | null): void => {
  if (!stream) return;
  processedStreamCleanups.get(stream)?.();
  processedStreamCleanups.delete(stream);
  stream.getTracks().forEach((track) => track.stop());
};
