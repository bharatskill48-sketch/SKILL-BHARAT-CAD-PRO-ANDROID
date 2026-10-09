# izCAD 2.0 — 9 Ekim 2026

Mevcut koyu tema, renkler, ikonlar ve ana ekran tasarımı korunmuştur.

- Çizim kitaplığına klasör içinde arama, ad/tarih/boyut sıralaması ve birden fazla çizimi birlikte ekleme eklendi.
- Aynı adlı dosyalar mevcut çizimin üzerine yazılmadan ayrı kopyalar olarak saklanıyor.
- Klasör ve dosya işlemleri atomik hâle getirildi; eşzamanlı işlemler ve yetersiz depolama durumunda yarım kayıtların önüne geçildi.
- 1.x kitaplık veritabanı ve paket kimliği korunuyor; güncellemede veri sıfırlanmıyor.
- Kitaplığı açıp kapatırken mevcut çizim ve kamera görünümü korunuyor.
- Android geri tuşu iletişim kutularını, klasörleri ve çizim ekranını takip ediyor.
- DXF worker hataları, yükleme zaman aşımı, iptal ve WebGL kaynak temizliği iyileştirildi.
- Eski DXF dosyalarında Türkçe dâhil desteklenen kod sayfaları algılanıyor.
- Kayıtlı görünüm, katman görünürlüğü ve iç içe XCLIP desteği sağlamlaştırıldı.
- Boş dosyalara ve 128 MiB üzeri kaynak/dönüşüm çıktısına kontrollü hata eklendi. Bu sınır, her küçük dosyanın her cihazda açılabileceği garantisi değildir.
- Hata ekranına tekrar deneme ve geri dönüş eklendi; depolama hataları görünür bildiriliyor.
- Erişilebilir dosya düğmeleri, iletişim kutusu odağı, klavye ile geri dönüş ve ilerleme göstergesi iyileştirildi.
- Capacitor 8.4.3 güvenlik düzeltmesine güncellendi; test araçları ve ilgili alt bağımlılıklar güncellendi.
- Android API 36, release imzalama seçenekleri, kaynak/paket bütünlüğü kontrolleri ve yayın rehberi hazırlandı.

## Play Store değişiklik metni — Türkçe

izCAD 2.0: Mevcut tasarım korundu. Çizim kitaplığına arama, sıralama ve toplu dosya ekleme geldi. Aynı adlı çizimler artık ayrı saklanıyor. DXF/DWG açma, Türkçe metinler, iptal, Android geri tuşu ve bellek yönetimi iyileştirildi. Güvenlik ve kararlılık düzeltmeleri yapıldı. Çizimleriniz cihazınızda kalır.

## Play Store release notes — English

izCAD 2.0 keeps the familiar design and adds library search, sorting and batch import. Drawings with the same name are kept separately. Improved DXF/DWG loading, legacy text encodings, cancellation, Android back navigation and memory management. Includes security and stability fixes. Your drawings stay on your device.
