# izCAD 2.0 — Play Store güncelleme rehberi

Hazırlık tarihi: **10 Ekim 2026**. Bu sürüm mevcut uygulamanın güncellemesidir.

Yerel doğrulama: **157 web testi, 7 Android testi, üretim derlemesi ve 25 Android
kaynak kontrolü geçti.** Release lint sıfır hata bildirdi; 19 kaynak/araç zinciri
uyarısı var. Güncel debug APK ve imzasız AAB üretildi; paketlerin üretim
dosyalarıyla birebir eşleşmesi doğrulandı. Tarayıcıda 3.000 mm kenar, 5 m
köşegen, 14 m çevre ve 12 m² alan; PDF sayfa geçişi/yakınlaştırma; ZIP ve RAR
seçimli çıkarma denendi. RAR4/RAR5 motoru gerçek upstream test dosyalarıyla
doğrulandı. Görseldeki özgün DWG dosyası sağlanmadığından o dosyada ilk
yakınlaştırma ve Android durum çubuğu için son gerçek cihaz kontrolü gerekir.

Bu 2.0 paketi geçici 2B CAD ölçümü, PDF görüntüleme ve arşiv içe aktarma içerir.
Çizim üstüne not ekleme, düzenlenmiş DWG kaydetme ve PDF ölçümü yoktur.
Şifreli PDF/arşiv, çok parçalı arşiv ve ZIP64 desteklenmez. PDF için güncel
Android System WebView kullanılmalıdır.

## Sürüm ve kullanıcı verileri

| Ayar | Değer |
| --- | --- |
| Paket kimliği | `com.izcad.viewer` — mevcut Play uygulamasıyla aynı |
| Android versionName | `2.0` |
| Web/package sürümü | `2.0.0` |
| Varsayılan versionCode | `4` — kaynak projedeki önceki kod `3` |
| Minimum / hedef Android | API 26 / API 36 |
| Kitaplık | Aynı IndexedDB adı ve v1 şeması korunur |

**Play Console'da daha önce yüklenen en yüksek versionCode'u kontrol edin.**
En yüksek kod 4 veya daha fazlaysa yeni derlemede daha büyük, kullanılmamış bir
kod verin. Kodun benzersizliği yalnızca yerel projeden doğrulanamaz.
Android bu kodu güncellemelerin sıralaması için kullanır.
[Android sürümleme belgesi](https://developer.android.com/studio/publish/versioning).

Güncelleme testinde mevcut uygulamayı kaldırmayın ve uygulama verilerini
temizlemeyin. Kitaplık ve dil tercihi korunmalıdır. Android yedekleme ve cihazlar
arası aktarım kapalıdır; bu nedenle kullanıcı özgün çizim dosyalarını ayrıca
saklamalıdır. Aynı adlı yeni dosyalar `plan (2).dxf` gibi ayrı kaydedilir.

## Derleme

Node.js 22.12 veya üzeri, JDK 21 ve Android SDK 36 kullanın.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run android:prepare
$env:JAVA_HOME='C:\Program Files\Java\jdk-21.0.10'
cd android
.\gradlew.bat testDebugUnitTest lintRelease assembleDebug bundleRelease
```

Farklı bir JDK 21 kuruluysa kendi dizinini kullanın. Daha büyük kod örneği:

```powershell
.\gradlew.bat bundleRelease -PIZCAD_VERSION_CODE=5
```

Çıktılar:

- Test APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release AAB: `android/app/build/outputs/bundle/release/app-release.aab`

Debug APK, Play güncellemesinin imzasını taşımaz. Mevcut Play kurulumunun üstüne
debug APK kurmaya çalışmak imza uyuşmazlığı oluşturabilir. Güncelleme ve verilerin
korunması testini Play Internal Testing üzerinden yapın.

## Mevcut yükleme anahtarıyla imzalama

Release derlemesi için yeni bir keystore oluşturmayın. Play App Signing kullanılan
uygulamada mevcut **upload key** kullanılmalıdır. Anahtar sıfırlama gerekiyorsa
Play Console'un resmi sürecini izleyin.
[Google Play imzalama belgesi](https://developer.android.com/studio/publish/app-signing).

Android Studio'da **Build → Generate Signed App Bundle / APK → Android App Bundle**
ile mevcut anahtarı seçebilirsiniz. Alternatif olarak dört ayarın tamamını güvenli
yerel ortamda sağlayın:

```text
IZCAD_KEYSTORE_FILE
IZCAD_KEYSTORE_PASSWORD
IZCAD_KEY_ALIAS
IZCAD_KEY_PASSWORD
```

Gradle ortam değişkenlerini veya kullanıcıya özel Gradle properties değerlerini
okur. Parolaları komut geçmişine, kaynak koduna, bu belgeye ya da Git'e yazmayın.
Hiçbiri verilmezse AAB **imzasız** oluşturulur; kısmi ayarlarda derleme açık hata
verir. İmzasız AAB doğrudan Play'e yüklenemez.

## Son paketi doğrulama

Proje kökünde:

```powershell
npm.cmd run android:verify
npm.cmd run android:verify:release
npm.cmd run android:verify:release -- android/app/build/outputs/bundle/release/app-release.aab --require-signed
```

Kaynak doğrulaması paket kimliği, sürüm, SDK, çevrimdışı izinler ve senkronlanan
varlıkların güncel build ile aynı olduğunu kontrol eder. Paket doğrulaması AAB/APK
içindeki web varlıklarını karşılaştırır; WASM, font ve lisans dosyalarını, source map
yokluğunu ve yerel `.so` dosyası bulunmadığını denetler. İmzalı AAB ayrıca
`jarsigner` ile doğrulanır. `--require-signed` yalnızca AAB içindir; APK imzası
Android SDK `apksigner` ile doğrulanmalıdır. Doğru upload key'in kullanıldığının son doğrulaması
Play Console'a aittir.

API 36 hedeflenmiştir; yayın sırasında Console'un güncel uyarılarını kontrol edin.
[Google Play hedef API koşulları](https://support.google.com/googleplay/android-developer/answer/11926878).
16 KB sayfa boyutu açısından WASM bir Android NDK `.so` dosyası değildir. Pakete
ileride native kütüphane eklenirse ELF ve üretilmiş APK hizalaması ayrıca
doğrulanmalıdır. [Android 16 KB belgesi](https://developer.android.com/guide/practices/page-sizes).

## Yüklemeden önce cihazda kontrol

- 1.x üstüne Internal Testing güncellemesi: klasörler, dosyalar ve dil tercihi korunuyor.
- Küçük ve gerçek DXF/DWG dosyaları, Türkçe TEXT/MTEXT ve farklı DWG sürümleri açılıyor.
- Uçak modunda uygulamayı yeniden başlatıp çizim açma çalışıyor.
- Pan, pinch, zoom, Fit ve Reset; portre/yatay telefon ve tablet görünümü doğru.
- Dosya açılırken İptal/Geri, bozuk dosyada hata ve tekrar deneme çalışıyor.
- Kitaplık araması, toplu ekleme, kopyalama/taşıma ve aynı adlı dosyaları koruma doğru.
- Sistem dosya yöneticisindeki **Birlikte aç / Paylaş** akışı ve uygulamaya geri dönme çalışıyor.
- Eski/düşük bellekli cihaz ve güncel Android üzerinde arka arkaya çizim açma deneniyor.

128 MiB sınırı bir bellek güvenlik önlemidir; desteklenen dosya kapasitesi
garantisi değildir. Dönüştürülmüş DXF de bu sınıra tabidir. Karmaşık küçük bir
çizim bile bazı cihazlarda bellek sınırını aşabilir.

## Play Console'a hazırlanacaklar

1. İmzalı AAB'yi önce **Internal Testing** kanalına yükleyin.
2. [CHANGELOG.md](CHANGELOG.md) içindeki Türkçe/İngilizce kısa sürüm notlarını kullanın.
3. Gizlilik politikası bağlantısının herkese açık olduğunu ve
   [PRIVACY_POLICY.md](PRIVACY_POLICY.md) ile uyumunu kontrol edin.
4. Data Safety beyanını son pakete göre gözden geçirin. Uygulamada internet,
   reklam, analytics ve geniş depolama izni eklenmemiştir.
5. Aynı binary sürümünün izCAD kaynak kodunu ve LibreDWG corresponding source
   erişimini [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) uyarınca hazırlayın.
6. Cihaz testleri ve Console kontrollerinden sonra üretim güncellemesini yayınlayın.

Bu çalışma Play Console'a yükleme veya üretim yayını yapmaz. Otomatik testlerin
ve yerel tarayıcı kontrollerinin geçmesi, fiziksel Android cihaz testinin yerine
geçmez.
