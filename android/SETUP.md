# 📱 Android Proje Kurulumu - Adım Adım

## ✅ Hazırlanan Dosyalar

Tüm gerekli dosyalar oluşturuldu! İşte proje yapısı:

```
android/
├── app/
│   ├── build.gradle                  ✅ Uygulama bağımlılıkları
│   ├── proguard-rules.pro           ✅ ProGuard kuralları
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml   ✅ Uygulama manifest
│           ├── java/com/cryptoarbitrage/scanner/
│           │   ├── MainActivity.kt   ✅ Ana aktivite (GERÇEK API)
│           │   └── ExchangeApiService.kt  ✅ Exchange API servisi
│           └── res/
│               ├── layout/
│               │   ├── activity_main.xml      ✅ Ana ekran layout
│               │   └── item_opportunity.xml   ✅ Fırsat kartı layout
│               └── values/
│                   ├── colors.xml    ✅ Renkler
│                   ├── strings.xml   ✅ Metinler
│                   └── themes.xml    ✅ Temalar
├── build.gradle                      ✅ Root build config
├── settings.gradle                   ✅ Proje ayarları
├── gradle.properties                 ✅ Gradle özellikleri
├── README.md                         ✅ Detaylı dokümantasyon
├── CHANGES.md                        ✅ Eski vs Yeni karşılaştırma
└── SETUP.md                          ✅ Bu dosya
```

---

## 🚀 Kurulum Adımları

### 1️⃣ Projeyi Bilgisayarınıza İndirin

```bash
# GitHub'dan klonlayın
git clone https://github.com/mellorina13-tech/crypto-arbitrage.git
cd crypto-arbitrage

# Android branch'ine geçin
git checkout claude/android-crypto-arbitrage-011CUQBQbktBdijL1AJdvHCK
```

### 2️⃣ Android Studio'da Açın

1. **Android Studio**'yu açın
2. **File → Open** (veya **Open an Existing Project**)
3. `crypto-arbitrage/android/` klasörünü seçin
4. **OK** butonuna tıklayın

### 3️⃣ Gradle Sync Bekleyin

Android Studio otomatik olarak:
- Gradle dosyalarını okuyacak
- Bağımlılıkları indirecek
- Projeyi build edecek

**Bu işlem 2-5 dakika sürebilir** (ilk sefer için)

### 4️⃣ Eksik Dosyaları Kontrol Edin

Eğer hata alırsanız, aşağıdaki dosyaların eksik olup olmadığını kontrol edin:

#### A. Launcher Icon (app icon)

```bash
# Varsayılan Android icon kullanılacak
# Özel icon için:
android/app/src/main/res/
├── mipmap-hdpi/ic_launcher.png
├── mipmap-mdpi/ic_launcher.png
├── mipmap-xhdpi/ic_launcher.png
├── mipmap-xxhdpi/ic_launcher.png
└── mipmap-xxxhdpi/ic_launcher.png
```

**Çözüm:** Android Studio → **File → New → Image Asset** → Icon oluştur

#### B. gradle-wrapper.properties (Eğer eksikse)

```bash
# Android Studio otomatik oluşturur, ama manuel için:
mkdir -p android/gradle/wrapper
```

Dosya içeriği:
```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.0-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

### 5️⃣ Uygulamayı Çalıştırın

1. **Emulator veya Gerçek Cihaz** bağlayın
2. **Run → Run 'app'** (veya **Shift + F10**)
3. Uygulama cihazda açılacak

---

## 🔧 Olası Hatalar ve Çözümleri

### ❌ Hata: "SDK location not found"

**Çözüm:**
```bash
# android/local.properties dosyası oluşturun:
echo "sdk.dir=/Users/YOUR_USERNAME/Library/Android/sdk" > android/local.properties

# Windows için:
# sdk.dir=C\:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk
```

### ❌ Hata: "R cannot be resolved"

**Sebep:** Layout dosyaları hatalı veya Gradle sync tamamlanmadı

**Çözüm:**
1. **Build → Clean Project**
2. **Build → Rebuild Project**
3. **File → Invalidate Caches / Restart**

### ❌ Hata: "Manifest merger failed"

**Sebep:** AdMob meta-data hatalı

**Çözüm:** `AndroidManifest.xml` içindeki AdMob ID'yi test ID ile değiştirin:
```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-3940256099942544~3347511713"/>
```

### ❌ Hata: "Cleartext HTTP traffic not permitted"

**Sebep:** Android 9+ HTTPS gerektirir

**Çözüm:** Tüm API'ler zaten HTTPS kullanıyor ✅ (kod içinde düzeltildi)

### ❌ Hata: "Duplicate class kotlin.coroutines..."

**Sebep:** Kotlin coroutine versiyon çakışması

**Çözüm:** `app/build.gradle` içinde:
```gradle
configurations.all {
    resolutionStrategy {
        force 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
    }
}
```

---

## 📱 Test Etme

### İlk Çalıştırma

1. Uygulamayı açın
2. **"⚡ Scan Live Markets"** butonuna basın
3. 30-60 saniye bekleyin
4. Gerçek arbitrage fırsatları listelenecek

### Ne Beklenmeli?

- ✅ "Fetching prices from 8 exchanges..." mesajı
- ✅ Progress bar görünür
- ✅ Opportunity kartları belirir
- ✅ Gerçek exchange isimleri (Binance, KuCoin, etc.)
- ✅ Gerçek fiyatlar

### Ne Olmamalı?

- ❌ Her seferinde aynı fırsatlar
- ❌ Çok yüksek spreadler (%10+)
- ❌ Her coin için fırsat

**Not:** Gerçek piyasalarda arbitrage nadirdir, bazen hiç fırsat olmayabilir!

---

## 🎨 Özelleştirme

### Renkleri Değiştirin

`android/app/src/main/res/values/colors.xml`:
```xml
<color name="blue_primary">#00d2ff</color>  <!-- Ana renk -->
<color name="dark_background">#1a1a2e</color>  <!-- Arkaplan -->
```

### Minimum Spread Değiştirin

`MainActivity.kt` satır 213:
```kotlin
val minSpread = minSpreadInput.text.toString().toDoubleOrNull() ?: 0.1
```
`0.1` değerini değiştirin (örn: `0.5` daha az fırsat, `0.05` daha çok fırsat)

### Coin Limiti Değiştirin

`activity_main.xml` içindeki Spinner değerlerini düzenleyin:
```xml
val coinLimits = arrayOf("Top 25", "Top 50", "Top 100", "Top 250")
```

---

## 🔐 AdMob Gerçek ID Kullanımı

Test için varsayılan AdMob ID kullanılıyor. Production için:

1. [AdMob Console](https://admob.google.com/) → Uygulama oluştur
2. Banner Ad Unit oluştur
3. `AndroidManifest.xml` güncelleyin:
```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
```
4. `activity_main.xml` güncelleyin:
```xml
app:adUnitId="ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ"
```

---

## 📊 Performans İyileştirmeleri

### Daha Hızlı Tarama

`ExchangeApiService.kt` satır 175:
```kotlin
symbols.chunked(10).forEach { batch ->  // 10 → 20 yapın
```

### Daha Fazla Exchange

`ExchangeApiService.kt` içine yeni exchange ekleyin:
```kotlin
ExchangeConfig(
    name = "Kraken",
    fee = 0.26,
    urlBuilder = { symbol -> "https://api.kraken.com/0/public/Ticker?pair=${symbol}USD" },
    priceParser = { response -> /* JSON parse et */ }
)
```

---

## 🐛 Debug Modda Çalıştırma

### Logcat'te API Çağrılarını İzleyin

Android Studio → **Logcat** → Filtre: `ExchangeApi`

Göreceğiniz loglar:
```
✓ BTC: 8/8 exchanges
✓ ETH: 7/8 exchanges
⚠️ LION: 2/8 exchanges (normal, tüm exchange'lerde yok)
✅ Found 5 arbitrage opportunities
```

### Breakpoint Koyun

`MainActivity.kt` satır 260'a breakpoint koyun:
```kotlin
if (netSpread >= minSpread) {  // ← BURAYA
```

---

## 📦 APK Oluşturma

### Debug APK (Test için)

```bash
cd android
./gradlew assembleDebug

# APK konumu:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK (Yayın için)

1. Keystore oluştur:
```bash
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
```

2. `app/build.gradle` güncelleyin:
```gradle
android {
    signingConfigs {
        release {
            storeFile file("my-release-key.jks")
            storePassword "YOUR_PASSWORD"
            keyAlias "my-alias"
            keyPassword "YOUR_PASSWORD"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            ...
        }
    }
}
```

3. Build:
```bash
./gradlew assembleRelease
```

---

## 📚 Daha Fazla Bilgi

- **Detaylı API Dokümantasyonu:** `android/README.md`
- **Kod Karşılaştırması:** `android/CHANGES.md`
- **Exchange API Docs:** Her exchange'in resmi API dokümantasyonu

---

## ✅ Başarılı Kurulum Kontrol Listesi

- [ ] Android Studio projeyi açtı
- [ ] Gradle sync başarılı
- [ ] Build hatasız
- [ ] Emulator/cihazda çalışıyor
- [ ] "Scan" butonu çalışıyor
- [ ] Gerçek fiyatlar gösteriliyor
- [ ] Exchange isimleri görünüyor (Binance, KuCoin, etc.)
- [ ] Fırsatlar listeleniyor (veya "No opportunities" mesajı)

Hepsi ✅ ise TEBRİKLER! 🎉 Uygulama çalışıyor!

---

## 🆘 Yardım Gerekiyorsa

Hala hata alıyorsanız:

1. **Hata mesajının ekran görüntüsünü** alın
2. **Logcat çıktısını** kopyalayın
3. **Android Studio versiyonunuzu** kontrol edin (önerilen: 2023.1+)
4. **Build Gradle çıktısını** kontrol edin

**İpucu:** Çoğu hata Gradle sync veya R class ile ilgilidir → **Clean + Rebuild** genelde çözer!

---

Başarılar! 🚀
