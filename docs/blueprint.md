# **App Name**: Kanka Voice

## Core Features:

- Yerel Giriş Ekranı: Kullanıcı adı girişi ('İsmin' etiketi, 'İsmini yaz' yer tutucusu, 'Sohbete Katıl' butonu) ve geçerli Türkçe yerelleştirme.
- Kalıcı Oturum Yönetimi: Kullanıcı adını localStorage'a kaydeder ve sonraki ziyaretlerde otomatik oturum açmayı sağlar. 'İsmi Değiştir' veya 'Çıkış Yap' seçeneği ile yerel veriyi sıfırlama.
- Sabit Oda Navigasyonu: Discord benzeri sol kenar çubuğunda önceden tanımlanmış odaları ('Genel', 'Oyun', 'Muhabbet') gösterir. Tıklanabilir oda düğmeleri.
- Oda İçeriği Görüntüleme: Seçilen odanın adını ana alanda gösterir.
- Sahte Çevrimiçi Kullanıcı Listesi: Ana alanda Discord benzeri, örnek çevrimiçi kullanıcı adlarını gösterir.
- Kullanıcı Adı Görüntüleme: Ana uygulamanın alt kısmında mevcut kullanıcının adını görüntüler.
- Tamamen Türkçe Kullanıcı Arayüzü: Uygulamadaki tüm görünen metin elemanları (etiketler, düğmeler, yer tutucular) Türkçe'dir.

## Style Guidelines:

- Primary color: `#4D33B3` (deep violet-blue) for interactive elements and emphasis, creating a distinctive and calm brand presence.
- Background color: `#1F1A26` (very dark desaturated purple-gray), providing a consistent dark mode aesthetic typical for chat applications, enhancing readability for text.
- Accent color: `#7AB2E5` (light muted blue) for highlights, selected states, and secondary calls to action, offering clear contrast against the primary and background colors.
- Body and headline font: 'Inter' (sans-serif) for a modern, legible, and objective feel across all text elements, consistent with a digital communication platform.
- Use minimalist and clean vector-based icons that align with a modern communication app aesthetic.
- Two-column layout featuring a fixed-width left sidebar for navigation (rooms) and a dynamic main content area. The current user's name is anchored at the bottom of the main app.
- Subtle, smooth transitions for state changes and navigation, enhancing user experience without being distracting.