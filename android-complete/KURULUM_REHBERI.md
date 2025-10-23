# 📱 Crypto Arbitrage - Sıfırdan Kurulum Rehberi

## ✅ ÇALIŞAN PROJE - Package: com.cryptoarbitrage.scanner

---

## 🚀 KURULUM ADIMLARI

### 1️⃣ Yeni Android Projesi Oluşturun

Android Studio'da:
```
File → New → New Project
→ Empty Activity
→ Name: CryptoArbitrage
→ Package name: com.cryptoarbitrage.scanner
→ Language: Kotlin
→ Minimum SDK: API 24
→ Finish
```

**İLK GRADLE SYNC BİTMESİNİ BEKLEYİN!** (2-3 dakika)

---

### 2️⃣ Dosyaları Kopyalayın

#### A) Kotlin Dosyaları

**Kopyalayın:**
- `android-complete/app/src/main/java/com/cryptoarbitrage/scanner/MainActivity.kt`
- `android-complete/app/src/main/java/com/cryptoarbitrage/scanner/ExchangeApiService.kt`

**Nereye:**
```
PROJENIZ/app/src/main/java/com/cryptoarbitrage/scanner/
```

**Nasıl:**
1. Android Studio'da eski `MainActivity.kt`'yi SİLİN
2. Yeni dosyaları kopyalayın

#### B) Layout Dosyaları

**Kopyalayın:**
- `android-complete/app/src/main/res/layout/activity_main.xml`
- `android-complete/app/src/main/res/layout/item_opportunity.xml`

**Nereye:**
```
PROJENIZ/app/src/main/res/layout/
```

**Nasıl:**
1. Eski `activity_main.xml`'i SİLİN
2. İki yeni dosyayı kopyalayın

#### C) Values Dosyaları

**Kopyalayın:**
- `android-complete/app/src/main/res/values/colors.xml`
- `android-complete/app/src/main/res/values/strings.xml`
- `android-complete/app/src/main/res/values/themes.xml`

**Nereye:**
```
PROJENIZ/app/src/main/res/values/
```

**Nasıl:**
1. Eski dosyaları SİLİN veya ÜZERİNE YAZIN
2. Üç yeni dosyayı kopyalayın

#### D) build.gradle

**ÖNEMLI:** Bu dosyayı TAM OLARAK kopyalayın!

**Kopyalayın:**
- `android-complete/app/build.gradle`

**Nereye:**
```
PROJENIZ/app/build.gradle
```

**Üzerine yazın!**

#### E) AndroidManifest.xml

**Kopyalayın:**
- `android-complete/app/src/main/AndroidManifest.xml`

**Nereye:**
```
PROJENIZ/app/src/main/AndroidManifest.xml
```

**Üzerine yazın!**

---

### 3️⃣ Gradle Sync Yapın

**ÇOK ÖNEMLİ!**

Android Studio'da:
```
File → Sync Project with Gradle Files
```

**Veya:**
- Toolbar'daki fil simgesine tıklayın 🐘

**BEKLEYIN:** 2-3 dakika (dependency'leri indirecek)

---

### 4️⃣ Build Yapın

```
Build → Clean Project
(Bekle: 10 saniye)

Build → Rebuild Project
(Bekle: 1-2 dakika)
```

**Hata olmamalı! 0 error görmelisiniz.**

---

### 5️⃣ Çalıştırın!

```
Run → Run 'app' (Shift + F10)
```

Veya yeşil play butonuna basın ▶️

---

## 📂 Proje Yapısı (Sonuç)

```
CryptoArbitrage/
├── app/
│   ├── build.gradle                               ✅
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml                ✅
│           ├── java/
│           │   └── com/
│           │       └── cryptoarbitrage/
│           │           └── scanner/
│           │               ├── MainActivity.kt    ✅
│           │               └── ExchangeApiService.kt ✅
│           └── res/
│               ├── layout/
│               │   ├── activity_main.xml          ✅
│               │   └── item_opportunity.xml       ✅
│               └── values/
│                   ├── colors.xml                 ✅
│                   ├── strings.xml                ✅
│                   └── themes.xml                 ✅
├── build.gradle                                   ✅
├── settings.gradle                                ✅
└── gradle.properties                              ✅
```

---

## ✅ Başarı Kontrol Listesi

Tamamsa tik atın:

- [ ] Yeni proje oluşturuldu
- [ ] İlk Gradle sync tamamlandı
- [ ] Kotlin dosyaları kopyalandı (2 adet)
- [ ] Layout dosyaları kopyalandı (2 adet)
- [ ] Values dosyaları kopyalandı (3 adet)
- [ ] `app/build.gradle` değiştirildi
- [ ] `AndroidManifest.xml` değiştirildi
- [ ] Gradle sync yapıldı (2. kez)
- [ ] Build başarılı (0 error)
- [ ] Uygulama çalışıyor

---

## 🐛 Sorun Giderme

### Hata: "Unresolved reference: R"

**Çözüm:**
```
1. File → Invalidate Caches / Restart
2. Invalidate and Restart seçin
3. Gradle sync bekleyin
4. Build → Rebuild Project
```

### Hata: "CoordinatorLayout not found"

**Sebep:** Dependency eksik

**Çözüm:** `app/build.gradle` dosyasını kontrol edin, şu satır olmalı:
```gradle
implementation 'androidx.coordinatorlayout:coordinatorlayout:1.2.0'
```

Sonra Gradle Sync yapın.

### Hata: "Package name doesn't match"

**Çözüm:**
1. Tüm `.kt` dosyalarının ilk satırı:
   ```kotlin
   package com.cryptoarbitrage.scanner
   ```

2. `app/build.gradle`:
   ```gradle
   namespace 'com.cryptoarbitrage.scanner'
   ```

3. `AndroidManifest.xml`:
   ```xml
   <manifest ...>  <!-- package YOK -->
   ```

### Hata: "Sync failed"

**Çözüm:**
1. Android Studio'yu kapatın
2. Proje klasöründeki `.idea` ve `.gradle` klasörlerini SİLİN
3. Android Studio'yu açın
4. Projeyi açın (Gradle sync otomatik başlar)

---

## 🎯 İlk Çalıştırma

Uygulama açıldığında:

1. **"Ready to scan"** yazısı görünecek
2. **"⚡ Scan Live Markets"** butonuna basın
3. **30-60 saniye bekleyin**
4. Gerçek arbitrage fırsatları listelenecek!

**Ne göreceksiniz:**
- ✅ Dark mode UI
- ✅ İstatistik kartları (Opportunities, Best Spread, Coins)
- ✅ Tarama ayarları
- ✅ Fırsat kartları (coin, exchange, fiyatlar, kar)
- ✅ Gerçek exchange fiyatları

---

## 📊 Özellikler

### ✅ Gerçek API Entegrasyonu
- 8 Exchange: Binance, KuCoin, Gate.io, MEXC, Bybit, OKX, Huobi, Bitget
- CoinGecko coin listesi
- Paralel API çağrıları (hızlı)

### ✅ Profesyonel UI
- Dark mode
- Material Design
- Responsive kartlar
- İstatistik gösterimi

### ✅ Ayarlanabilir
- Minimum spread filtresi
- Coin limiti (25, 50, 100, 250)
- Volume filtresi

### ✅ Otomatik Yenileme
- 5 dakikada bir otomatik tarama

---

## 📚 Dosya Açıklamaları

| Dosya | Ne İşe Yarar |
|-------|--------------|
| `MainActivity.kt` | Ana aktivite, UI kontrolü, coin listesi çekme |
| `ExchangeApiService.kt` | 8 exchange'den gerçek fiyat çekme |
| `activity_main.xml` | Ana ekran layout (stats, controls, list) |
| `item_opportunity.xml` | Her fırsat kartının layout'u |
| `colors.xml` | Renk paleti (#00d2ff, #1a1a2e, etc.) |
| `strings.xml` | Tüm metinler |
| `themes.xml` | Material tema ayarları |
| `build.gradle` | Dependency'ler ve build config |
| `AndroidManifest.xml` | İzinler ve activity tanımı |

---

## 🔗 GitHub

Tüm dosyalar GitHub'da:
```
https://github.com/mellorina13-tech/crypto-arbitrage/tree/claude/android-crypto-arbitrage-011CUQBQbktBdijL1AJdvHCK/android-complete
```

---

## ⚠️ Önemli Notlar

1. **Package İsmi:** `com.cryptoarbitrage.scanner` (değiştirmeyin!)
2. **Minimum SDK:** API 24 (Android 7.0)
3. **İnternet İzni:** Gerekli (AndroidManifest'te var)
4. **AdMob:** Test ID kullanılıyor (production için değiştirin)
5. **İlk Tarama:** 30-60 saniye sürer (normal)

---

## 🎉 Başarılı!

Tebrikler! Artık çalışan bir crypto arbitrage uygulamanız var!

**Test için:**
1. Emulator veya gerçek cihazda çalıştırın
2. "Scan Live Markets" butonuna basın
3. Sonuçları görün

**Not:** Bazen hiç fırsat çıkmayabilir - bu normal! Gerçek piyasalarda arbitrage nadirdir.

---

## 💪 İyi Çalışmalar!

Sorularınız için: GitHub issues
