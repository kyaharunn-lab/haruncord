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

export const getLocalAudioStream = async (settings?: AudioSettings): Promise<MediaStream | null> => {
  try {
    // Daha yüksek ses kalitesi için gelişmiş kısıtlamalar
    const audioConstraints: any = {
      deviceId: settings?.deviceId ? { exact: settings.deviceId } : undefined,
      echoCancellation: settings?.echoCancellation ?? true,
      noiseSuppression: settings?.noiseSuppression ?? true,
      autoGainControl: settings?.autoGainControl ?? true,
      sampleRate: 48000, // 48kHz stüdyo kalitesi
      channelCount: 1,   // Mono ses (sesli sohbet için ideal)
      latency: 0,        // En düşük gecikme hedefi
      
      // Chromium tabanlı tarayıcılar için özel ses iyileştirme ayarları
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

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (error) {
    console.error("Mikrofon erişimi sırasında hata oluştu:", error);
    return null;
  }
};

export const createPeerConnection = (): RTCPeerConnection | null => {
  try {
    return new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
    const offer = await pc.createOffer();
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