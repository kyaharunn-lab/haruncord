/**
 * WebRTC yardımcı fonksiyonları.
 * Bu dosya temel bağlantı ve medya yönetimi işlemlerini içerir.
 */

export interface AudioSettings {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micSensitivity: number; // 0.0 - 1.0 (Hassasiyet eşiği)
  gateLevel: number;      // 0.0 - 1.0 (Gürültü kapısı agresifliği)
  gateSmoothing: number;  // 0.0 - 1.0 (Kapanış hızı/yumuşatma)
  micGain: number;       // 1.0 - 4.0 (Yazılımsal kazanç)
}

/**
 * Ham ses akışını Web Audio API ile işleyerek gelişmiş gürültü engelleme, 
 * kazanç ve ayarlanabilir gürültü kapısı uygular.
 */
export const processAudioStream = (stream: MediaStream, settings: AudioSettings): MediaStream => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      latencyHint: 'interactive',
      sampleRate: 48000,
    });

    const source = audioContext.createMediaStreamSource(stream);
    const destination = audioContext.createMediaStreamDestination();

    // 1. Pre-Gain Node: Sesi gate'e girmeden önce yükseltir (zayıf mikrofonlar için)
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(settings.micGain ?? 1.0, audioContext.currentTime);

    // 2. High-pass Filter: 150Hz altındaki düşük frekanslı uğultuları temizler.
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(150, audioContext.currentTime);

    // 3. Dynamics Compressor: Ses seviyesini dengeler.
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressor.knee.setValueAtTime(30, audioContext.currentTime);
    compressor.ratio.setValueAtTime(12, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressor.release.setValueAtTime(0.25, audioContext.currentTime);

    // 4. Noise Gate (Gürültü Kapısı) Kontrol Ünitesi
    const gateGain = audioContext.createGain();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    
    // İşleme zinciri: Source -> Gain -> HighPass -> Compressor -> Analyser -> GateGain -> Destination
    source.connect(gainNode);
    gainNode.connect(highPass);
    highPass.connect(compressor);
    compressor.connect(analyser);
    compressor.connect(gateGain);
    gateGain.connect(destination);

    const dataArray = new Float32Array(analyser.fftSize);
    let isOpen = false;
    let lastHighVolumeTime = 0;
    let consecutiveHighVolumeFrames = 0;
    
    // Eşik hesaplama: Kullanıcı hassasiyeti ve gate seviyesi birleşimi
    // gateLevel (0.0 - 1.0) -> Eşik değerini 0.02 ile 0.30 arasında scale eder.
    const threshold = 0.02 + (settings.micSensitivity * 0.15 * (settings.gateLevel ?? 1.0));

    // Yumuşatma (Smoothing): gateSmoothing -> 0.1s ile 0.8s arası release
    const releaseTime = 0.1 + ((settings.gateSmoothing ?? 0.5) * 0.7);

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
        if (consecutiveHighVolumeFrames >= 2) { // 2 frame spike rejection
          if (!isOpen) {
            gateGain.gain.setTargetAtTime(1, now, 0.005); // Attack (5ms)
            isOpen = true;
          }
          lastHighVolumeTime = now;
        }
      } else {
        consecutiveHighVolumeFrames = 0;
        if (isOpen && (now - lastHighVolumeTime) > releaseTime) {
          gateGain.gain.setTargetAtTime(0, now, 0.05); // Yumuşak kapanış
          isOpen = false;
        }
      }
    };

    const gateInterval = setInterval(updateGate, 20);

    stream.getTracks().forEach(track => {
      track.addEventListener('ended', () => {
        clearInterval(gateInterval);
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      });
    });

    return destination.stream;
  } catch (error) {
    console.error("Gelişmiş ses işleme hatası:", error);
    return stream;
  }
};

export const getLocalAudioStream = async (settings?: AudioSettings): Promise<MediaStream | null> => {
  try {
    const audioConstraints: any = {
      deviceId: settings?.deviceId ? { exact: settings.deviceId } : undefined,
      echoCancellation: settings?.echoCancellation ?? true,
      noiseSuppression: settings?.noiseSuppression ?? true,
      autoGainControl: settings?.autoGainControl ?? true,
      sampleRate: 48000,
      channelCount: 1,
      latency: 0,
      
      googEchoCancellation: true,
      googAutoGainControl: true,
      googNoiseSuppression: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true,
    };

    const constraints: MediaStreamConstraints = {
      audio: audioConstraints,
      video: false,
    };

    const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (rawStream && settings) {
      return processAudioStream(rawStream, settings);
    }

    return rawStream;
  } catch (error) {
    console.error("Mikrofon erişimi sırasında hata oluştu:", error);
    return null;
  }
};

export const createPeerConnection = (): RTCPeerConnection | null => {
  try {
    return new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 10,
    });
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
    const senders = pc.getSenders();

    stream.getAudioTracks().forEach((track) => {
      const alreadyAdded = senders.some((sender) => sender.track === track);

      if (alreadyAdded) {
        return;
      }

      pc.addTrack(track, stream);
    });
  } catch (error) {
    console.error("Yerel track eklenirken hata oluştu:", error);
  }
};

export const createOffer = async (
  pc: RTCPeerConnection
): Promise<RTCSessionDescriptionInit | null> => {
  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
    });
    await pc.setLocalDescription(offer);
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
    if (pc.signalingState !== "stable") {
      return null;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

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
    if (desc.type === "answer") {
      if (pc.signalingState !== "have-local-offer") {
        return;
      }
    }

    if (desc.type === "offer") {
      if (pc.signalingState !== "stable") {
        return;
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(desc));
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
    if (!candidate) return;

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error("ICE candidate eklenirken hata oluştu:", error);
  }
};

export const closePeerConnection = (pc: RTCPeerConnection | null): void => {
  if (!pc) return;

  try {
    pc.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    pc.getReceivers().forEach((receiver) => {
      if (receiver.track) {
        receiver.track.stop();
      }
    });

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;

    pc.close();
  } catch (error) {
    console.error("Bağlantı kapatılırken hata oluştu:", error);
  }
};

export const setAudioOutputDevice = async (
  element: HTMLAudioElement | null,
  deviceId: string
): Promise<void> => {
  if (!element || !deviceId) return;
  
  if ('setSinkId' in element) {
    try {
      await (element as any).setSinkId(deviceId);
    } catch (error) {
      console.error("Hoparlör çıkışı değiştirilemedi:", error);
    }
  } else {
    console.warn("Bu tarayıcı setSinkId özelliğini desteklemiyor.");
  }
};
