# Crypto Arbitrage Android App

Android WebView uygulaması - crypto-arbitrage.app sitesinin mobil versiyonu.

## Özellikler

- ✅ crypto-arbitrage.app sitesini WebView içinde açar
- ✅ Tam ekran deneyim
- ✅ Geri tuşu desteği (WebView geçmişinde gezinme)
- ✅ İnternet bağlantısı kontrolü
- ✅ İlerleme çubuğu
- ✅ Hardware acceleration etkin
- ✅ JavaScript desteği
- ✅ Yerel depolama (localStorage) desteği

## Gereksinimler

- Android Studio Arctic Fox veya daha yeni
- Android SDK 24+ (Android 7.0 Nougat ve üzeri)
- JDK 8 veya üzeri

## Kurulum

1. Android Studio'yu açın
2. "Open an Existing Project" seçeneğini seçin
3. Bu `android` klasörünü seçin
4. Gradle sync işleminin tamamlanmasını bekleyin
5. Bir Android cihaz veya emulator seçin
6. "Run" butonuna tıklayın

## APK Oluşturma

### Debug APK

```bash
cd android
./gradlew assembleDebug
```

APK dosyası: `app/build/outputs/apk/debug/app-debug.apk`

### Release APK (İmzalı)

1. Keystore oluşturun (ilk seferinde):

```bash
keytool -genkey -v -keystore crypto-arbitrage.keystore -alias crypto-arbitrage -keyalg RSA -keysize 2048 -validity 10000
```

2. Release APK oluşturun:

```bash
./gradlew assembleRelease
```

3. APK'yı imzalayın:

```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore crypto-arbitrage.keystore \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  crypto-arbitrage
```

## Özelleştirme

### Site URL'sini Değiştirme

`MainActivity.java` dosyasındaki `WEBSITE_URL` sabitini düzenleyin:

```java
private static final String WEBSITE_URL = "https://crypto-arbitrage.app";
```

### Uygulama Adını Değiştirme

`app/src/main/res/values/strings.xml` dosyasını düzenleyin:

```xml
<string name="app_name">Crypto Arbitrage</string>
```

### Uygulama İkonu Ekleme

Uygulama ikonu için şu klasörlere `ic_launcher.png` ve `ic_launcher_round.png` dosyalarını ekleyin:

- `app/src/main/res/mipmap-mdpi/` (48x48 px)
- `app/src/main/res/mipmap-hdpi/` (72x72 px)
- `app/src/main/res/mipmap-xhdpi/` (96x96 px)
- `app/src/main/res/mipmap-xxhdpi/` (144x144 px)
- `app/src/main/res/mipmap-xxxhdpi/` (192x192 px)

Android Studio'da "File > New > Image Asset" kullanarak kolayca ikon oluşturabilirsiniz.

### Renk Temasını Değiştirme

`app/src/main/res/values/colors.xml` dosyasını düzenleyin:

```xml
<color name="colorPrimary">#00d2ff</color>
<color name="colorPrimaryDark">#0099cc</color>
<color name="colorAccent">#3a7bd5</color>
```

## Paket Yapısı

```
android/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/cryptoarbitrage/app/
│   │       │   └── MainActivity.java
│   │       ├── res/
│   │       │   ├── layout/
│   │       │   │   └── activity_main.xml
│   │       │   ├── values/
│   │       │   │   ├── colors.xml
│   │       │   │   ├── strings.xml
│   │       │   │   └── styles.xml
│   │       │   └── mipmap-*/
│   │       └── AndroidManifest.xml
│   ├── build.gradle
│   └── proguard-rules.pro
├── build.gradle
├── settings.gradle
└── gradle.properties
```

## Sorun Giderme

### Gradle Sync Hatası

- Android Studio'da "File > Invalidate Caches / Restart"
- `android` klasöründe terminal açın ve `./gradlew clean` çalıştırın

### WebView Boş Sayfa Gösteriyor

- İnternet izninin `AndroidManifest.xml` dosyasında olduğundan emin olun
- Cihazınızın internet bağlantısını kontrol edin

### APK Yüklenmiyor

- Developer options'da "Install unknown apps" iznini verin
- Minimum Android sürümünü kontrol edin (Android 7.0+)

## Lisans

Bu proje KarziTech tarafından geliştirilmiştir.

## İletişim

Sorularınız için: carlmorline@gmail.com
