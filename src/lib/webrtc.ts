/**
 * WebRTC yardımcı fonksiyonları.
 * Bu dosya temel bağlantı ve medya yönetimi işlemlerini içerir.
 */

export interface AudioSettings {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

/**
 * Ham ses akışını Web Audio API ile işleyerek gürültü azaltma ve filtreleme uygular.
 * Bu, Discord benzeri bir ses kalitesi elde etmek için yazılımsal bir işleme zinciri kurar.
 */
export const processAudioStream = (stream: MediaStream, settings: AudioSettings): MediaStream => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      latencyHint: 'interactive',
      sampleRate: 48000,
    });

    const source = audioContext.createMediaStreamSource(stream);
    const destination = audioContext.createMediaStreamDestination();

    // 1. High-pass Filter: 150Hz altındaki düşük frekanslı uğultuları (fan, klima vb.) temizler.
    const highPass = audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(150, audioContext.currentTime);
    highPass.Q.setValueAtTime(0.7, audioContext.currentTime);

    // 2. Peaking Filter: İnsan sesinin netliğini artırmak için 3kHz civarını hafifçe parlatır.
    const clarityFilter = audioContext.createBiquadFilter();
    clarityFilter.type = 'peaking';
    clarityFilter.frequency.setValueAtTime(3000, audioContext.currentTime);
    clarityFilter.gain.setValueAtTime(3, audioContext.currentTime);

    // 3. Dynamics Compressor: Ani ses yükselmelerini engeller ve kısık sesleri dengeler.
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressor.knee.setValueAtTime(30, audioContext.currentTime);
    compressor.ratio.setValueAtTime(12, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressor.release.setValueAtTime(0.25, audioContext.currentTime);

    // Zinciri oluştur: Source -> HighPass -> Clarity -> Compressor -> Destination
    source.connect(highPass);
    highPass.connect(clarityFilter);
    clarityFilter.connect(compressor);
    compressor.connect(destination);

    // İşlenmiş akışı döndür
    return destination.stream;
  } catch (error) {
    console.error("Ses işleme zinciri kurulamadı, ham ses kullanılıyor:", error);
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
      
      // Donanımsal hızlandırma ve özel algoritmalar
      googEchoCancellation: true,
      googAutoGainControl: true,
      googNoiseSuppression: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true,
      googAudioMirroring: false,
    };

    const constraints: MediaStreamConstraints = {
      audio: audioConstraints,
      video: false,
    };

    const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Eğer ayarlar uygunsa ses işleme zincirini uygula
    if (rawStream && settings) {
      console.log("Gelişmiş ses işleme zinciri aktif edildi.");
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
        console.log("Track zaten eklenmiş, atlandı.");
        return;
      }

      pc.addTrack(track, stream);
      console.log("Audio track eklendi.");
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
    console.log("Offer oluşturuldu.");
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
      console.log("Offer uygulanamadı, signalingState:", pc.signalingState);
      return null;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log("Answer oluşturuldu.");
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
        console.log(
          "Answer atlandı. Yanlış signalingState:",
          pc.signalingState
        );
        return;
      }
    }

    if (desc.type === "offer") {
      if (pc.signalingState !== "stable") {
        console.log(
          "Offer atlandı. Yanlış signalingState:",
          pc.signalingState
        );
        return;
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(desc));
    console.log("Remote description uygulandı:", desc.type);
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
    console.log("ICE candidate eklendi.");
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

    console.log("PeerConnection kapatıldı.");
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
      console.log("Hoparlör çıkışı değiştirildi:", deviceId);
    } catch (error) {
      console.error("Hoparlör çıkışı değiştirilemedi:", error);
    }
  } else {
    console.warn("Bu tarayıcı setSinkId (hoparlör seçimi) özelliğini desteklemiyor.");
  }
};
