# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Keep Exchange API models
-keepclassmembers class com.cryptoarbitrage.scanner.ExchangeApiService$** {
    *;
}

# Keep data classes
-keep class com.cryptoarbitrage.scanner.CoinData { *; }
-keep class com.cryptoarbitrage.scanner.ArbitrageOpportunity { *; }
-keep class com.cryptoarbitrage.scanner.Exchange { *; }

# Keep JSON parsing
-keep class org.json.** { *; }
-keepclassmembers class * {
    @org.json.* <methods>;
}

# Keep Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

# AdMob
-keep public class com.google.android.gms.ads.** {
   public *;
}

# Uncomment this to preserve the line number information for debugging stack traces.
-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to hide the original source file name.
#-renamesourcefileattribute SourceFile
