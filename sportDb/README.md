SportsUz Premium Bot
Telegram bot – SportsUz platformasining premium kontentiga obuna bo‘lgan foydalanuvchilar uchun yangiliklar, kanal havola, va obuna statusini ko‘rsatadi.

📘 Xususiyatlar
🔄 Yakka Kurash va Futbol sport turlari uchun premium obuna xizmatlari.

💳 To‘lov variantlari: Uzcard/Humo, Payme, Click yoki saqlangan kartalar orqali.

📊 Obuna holatini real vaqt rejimida ko‘rsatish.

🔧 Foydalanuvchi interfeysi matnlarining ko‘p tilda (uz / ru) qo‘llab‑quvvatlanishi.

🚀 Kanalga avtomatik ravishda havola yuborish (agar obuna faol bo‘lsa).



🧾 Texnologiyalar
🤖 Node.js / TypeScript Telegram bot

🗣 Multi-language tarjima: O‘zbek (uz) va Rus (ru)

💾 MongoDB orqali foydalanuvchi va obuna ma’lumotlarini saqlash

🔐 To‘lov uchun Payme, Click, va Uzcard/Humo integratsiyalari


⚙️ O‘rnatish bo‘yicha bosqichlar

git clone https://github.com/programmsoft/sportsuz-premium-bot.git
cd sportsuz-premium-bot
npm install


Environment vars .env fayliga qo‘shing:

BOT_TOKEN=...
MONGODB_URI=...
BASE_UZCARD_ONETIME_URL=...
# …


Ishga tushurish:

npm run build
npm run start yoki npm run dev


Umumiy file structura:

sportsuz-premium-bot/
├── src/
│   ├── api/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   ├── bot/
│   │   ├── constants
│   │   ├── bot.admin.ts
│   │   ├── bot.payment.ts
│   │   ├── bot-plan-recorder.ts
│   │   ├── bot.ts
│   │   ├── broadcast.handler.ts
│   │   ├── broadcast.service.ts
│   ├── config/
│   │   ├── index.ts
│   ├── database/
│   │   ├── db.ts
│   │   ├── models/
│   │   ├── seeders/
│   ├── payment-providers/
│   │   ├── click.service.ts
│   │   ├── payme.service.ts
│   │   ├── uzcard.service.ts
│   │   ├── webhook.handler.ts
│   │   └── payment.utils.ts
│   ├── schedulers/
│   │   ├── subscription-checker.ts
│   ├── services/
│   │   ├── auto-payment-monitor.ts
│   │   ├── user-subscription-expiration.service.ts
│   │   ├── subscription-monitor.ts
│   │   ├── subscription.service.ts
│   │   └── link.service.ts
│   ├── shared/
│   │   ├── types.ts
│   │   ├── constants.ts
│   │   ├── logger.ts
│   │   ├── enums.ts
│   │   └── interfaces.ts
│   ├── utils/
│   │   ├── formatter.ts
│   │   ├── date.ts
│   │   ├── currency.ts
│   │   ├── validator.ts
│   │   └── generator.ts
│   ├── videos/
│   │   |
│   │   └── video.mp4
│   └── index.ts
├── view/
│   ├── terms.html
│   ├── success.html
│   ├── error.html
│   ├── expired.html
│   └── payment.html
├── .idea/
│   ├── workspace.xml
│   ├── vcs.xml
│   ├── modules.xml
│   ├── misc.xml
│   └── project.iml
├── .env
├── package.json
└── README.md


✅ handlePaymentSuccessForFootball
Maqsadi:
Futbol sport turi uchun foydalanuvchi tomonidan to‘lov muvaffaqiyatli amalga oshirilganidan so‘ng, unga obuna yaratadi, kanalga taklif havolasi yuboradi va obuna tugash muddatini ko‘rsatib beradi.

✅ handlePaymentSuccessForWrestling
Maqsadi:
Yakka kurash (wrestling) sport turi uchun to‘lov muvaffaqiyatli amalga oshirilgach, foydalanuvchiga obuna yaratadi va unga kanalga kirish uchun havola yuboriladi. Obuna muddati haqida ma’lumot beriladi.

✅ handlePaymentSuccessForUzcard
Maqsadi:
Uzcard orqali to‘lov muvaffaqiyatli o‘tganidan keyin, foydalanuvchiga tegishli sport turi bo‘yicha obuna yaratadi va unga kanalga kirish havolasi hamda, agar mavjud bo‘lsa, to‘lov cheki yuboriladi.

✅ handleUzCardSubscriptionSuccess
Maqsadi:
Uzcard orqali 60 kunlik bonusli avtomatik obuna faollashtirilganda ishlaydi. Foydalanuvchiga sport turi (odatda futbol) bo‘yicha obuna yaratadi va kanalga kirish havolasini yuboradi.

✅ handleUzCardWrestlingSubscriptionSuccess
Maqsadi:
Uzcard orqali yakka kurash uchun obuna muvaffaqiyatli amalga oshirilgach, foydalanuvchining bonusli obunasini yaratadi va unga kanalga kirish havolasini yuboradi.

✅ handleAutoSubscriptionSuccess
Maqsadi:
Avtomatik (karta bog‘langan) to‘lov orqali obuna yangilanganda ishlaydi. Foydalanuvchining obunasini uzaytiradi va unga kanalga kirish havolasini yuboradi.


✅ handleAutoSubscriptionSuccessForWrestling
Maqsadi:
Yakka kurash (wrestling) uchun foydalanuvchining avtomatik to‘lovi muvaffaqiyatli amalga oshirilganda chaqiriladi. Foydalanuvchiga 30 kunlik obuna beriladi, obuna ma’lumotlari saqlanadi va kanalga kirish havolasi yuboriladi.

✅ handleCardAddedWithoutBonus
Maqsadi:
Foydalanuvchi karta qo‘shganidan so‘ng, bonuslarsiz oddiy (standard) obuna yangilanishini amalga oshiradi. Bu funksiya futbol sport turi uchun mo‘ljallangan. Obuna muvaffaqiyatli faollashtirilsa, kanalga havola va obuna muddati haqida xabar yuboriladi.

✅ handleCardAddedWithoutBonusForWrestling
Maqsadi:
Yakka kurash sport turi uchun karta qo‘shilgach bonuslarsiz obuna yangilanishini amalga oshiradi. Obuna muvaffaqiyatli faollashtirilsa, foydalanuvchiga kanal havolasi va obuna muddati haqida xabar yuboriladi.

✅ getAutoSubscriptionDailyStats
Maqsadi:
Kunlik avtomatik obuna statistikalarini (metrikaning har bir qadamida nechta foydalanuvchi qatnashganini) chiqaradi.
Statistikaga quyidagilar kiradi:

Har bir step (masalan, foydalanuvchi avtomatik to‘lovni bosganmi yoki to‘lovni tugatganmi) bo‘yicha count va uniqueUsersCount.

clickedAutoPayment va completedSubscription sonlari bilan yakuniy summary.

Bu funksiya monitoring va analytics uchun ishlatiladi.


✅ setupHandlers
Maqsadi:
Telegram bot uchun asosiy komanda va callback handlerlarni ro‘yxatdan o‘tkazadi.

/start – botni ishga tushirish komandasi.

/admin – admin komandasi.

callback_query – foydalanuvchidan keladigan inline tugmalarni boshqaradi.

/broadcast – admin tomonidan xabar yuborish funksiyasini ishga tushiradi.

✅ setupMiddleware
Maqsadi:
Bot uchun middleware’larni sozlaydi:

session middleware orqali SessionData obyektini yaratadi (masalan: hasAgreedToTerms).

Har bir kelgan foydalanuvchi haqida logger orqali chatIdni yozadi.

catch orqali xatoliklar logga yoziladi.

✅ handleCallbackQuery
Maqsadi:
Telegram botdan kelgan callback querylarni ajratib olib, har bir tugma bosilganda tegishli funksiyani chaqiradi.

Quyidagi holatlarni boshqaradi:

Mavjud kartani tanlash (use_existing_card_...)

Kartalar ro‘yxatini ko‘rsatish (show_cards_...)

Mavjud karta menyusi (existing_card_menu_...)

main_menu tugmasi bosilganda sessiyani tozalash

Maxsus tugmalar (masalan: subscribe, renew, uz, ru, card_menu) bo‘yicha handlerlarni chaqirish.

✅ showMainMenuForFootball
Maqsadi:
Foydalanuvchiga Futbol sport turi bo‘yicha asosiy menyuni ko‘rsatadi.

Sessionga selectedSport = 'football' deb yozadi.

Foydalanuvchini UserModelda yangilaydi.

Tugmalar: obuna bo‘lish, status, yangilash, orqaga.

Foydalanuvchining tiliga qarab matn yuboriladi (UZ yoki RU).

✅ showMainMenuForWrestling
Maqsadi:
Foydalanuvchiga Kurash (Wrestling) sport turi bo‘yicha asosiy menyuni ko‘rsatadi.

Sessionga selectedSport = 'wrestling' deb yozadi.

Foydalanuvchini UserModelda yangilaydi.

Tugmalar: obuna bo‘lish, status, yangilash, orqaga.

Foydalanuvchining tiliga qarab matn yuboriladi.

✅  showMainMenu
Maqsadi:
Foydalanuvchiga asosiy menyu ko‘rsatiladi. Bu menyuda sport turini tanlash mumkin: Futbol yoki Kurash.

hasAgreedToTerms sessiyada false qilib qayta o‘rnatiladi.

Foydalanuvchining tanlagan tili asosida xabar yuboriladi.




🔹 handleStart(ctx: BotContext): Promise<void>
Vazifasi:
/start komandasi bosilganda foydalanuvchini ro‘yxatdan o‘tkazadi va til tanlash menyusini ko‘rsatadi.

Qadamlar:

ctx.session.hasAgreedToTerms ni false ga o‘rnatadi.

createUserIfNotExist() funksiyasi orqali foydalanuvchini DBga qo‘shadi.

Til tanlash menyusini ko‘rsatadi: showlangMenu().

🔹 handleCardMenu(ctx: BotContext): Promise<void>
Vazifasi:
Foydalanuvchiga kartasi bo‘yicha amalga oshiriladigan amallar (masalan: o‘chirish) menyusini ko‘rsatadi.

Qadamlar:

Tilga qarab tugmalar matnlarini va javob xabarini aniqlaydi.

Inline tugma:

💳 Kartani o‘chirish – "delete_card"

🔙 Orqaga – "check_status"

🔹 handleStatus(ctx: BotContext): Promise<void>
Vazifasi:
Foydalanuvchining tanlangan sport turi bo‘yicha obuna holatini ko‘rsatadi.

Qadamlar:

Foydalanuvchini DBdan topadi (UserModel.findOne).

Agar selectedSport tanlanmagan bo‘lsa, showMainMenu chaqiriladi.

Obuna ma'lumotlari aniqlanadi (foydalanuvchining sport turiga qarab).

Agar obuna mavjud bo‘lmasa, subscribe qilishga undovchi xabar chiqadi.

Aks holda:

Obuna boshlangan va tugaydigan sanalar formatlanadi.

Obuna faolligi aniqlanadi.

🔗 Kanalga kirish havolasi beriladi (agar obuna aktiv bo‘lsa).

💳 Karta menyusi (agar karta mavjud bo‘lsa).

🔙 Asosiy menyu tugmasi har doim bo‘ladi.

🔹 handleSubscribeCallback(ctx: BotContext): Promise<void>
Vazifasi:
Foydalanuvchini obunaga yo‘naltiradi (agar allaqachon obuna bo‘lmagan bo‘lsa).

Qadamlar:

Foydalanuvchini topadi (UserModel orqali).

selectedSport sessiyada mavjudligini tekshiradi.

Agar foydalanuvchi allaqachon obuna bo‘lsa:

Obuna tugash sanasini ko‘rsatadi.

Faqat "check_status" tugmasi beriladi.

Agar obuna mavjud bo‘lmasa:

hasAgreedToTerms = false qilib o‘rnatiladi.

Foydalanuvchidan foydalanish shartlarini qabul qilish talab qilinadi.

📄 Foydalanish shartlari URL tugmasi beriladi.

✅ Qabul qilaman / ❌ Bekor tugmalari.

🔹 handleRenew(ctx: BotContext): Promise<void>
Vazifasi:
Foydalanuvchining obunasini yangilashga ruxsat berish yoki sababi bilan rad etish.

Qadamlar:

Foydalanuvchini aniqlaydi (UserModel.findOne).

selectedSport sessiyadan olinadi.

Obunaning mavjudligi va faolligi tekshiriladi.

Agar obuna mavjud bo‘lmasa, subscribe qilishga chaqiradi.

Agar obuna mavjud va tugashiga >3 kun qolgan bo‘lsa, yangilashga ruxsat berilmaydi, sabab ko‘rsatiladi.

Aks holda, foydalanish shartlariga rozi bo‘lish oynasi chiqariladi.

🔐 handleAgreement(ctx: BotContext)
Vazifasi:
Foydalanuvchi shartlarga rozilik bildirganidan keyin to‘lov turini tanlash menyusini ko‘rsatadi.

Amallar:

telegramId orqali foydalanuvchini bazadan izlaydi.

Topilmasa, xatolik xabari yuboriladi.

ctx.session.hasAgreedToTerms ni true qiladi.

showPaymentTypeSelection() metodini chaqiradi.

💳 handleOneTimePayment(ctx: BotContext)
Vazifasi:
Foydalanuvchi bir martalik to‘lovni tanlaganda ishlaydi.

Amallar:

Agar foydalanuvchi shartlarga rozi bo‘lmagan bo‘lsa, handleSubscribeCallback() chaqiriladi.

UserModel orqali foydalanuvchi topiladi.

selectedSport (tanlangan sport turi) tekshiriladi.

Agar foydalanuvchi sport tanlamagan bo‘lsa, xabar ko‘rsatiladi.

getOneTimePaymentMethodKeyboard() orqali to‘lov tugmalari chiqariladi.

📂 showPaymentTypeSelection(ctx: BotContext)
Vazifasi:
Foydalanuvchiga to‘lov turlari menyusini ko‘rsatadi.

To‘lov variantlari:

Obuna (60 kun bepul)

Bir martalik to‘lov

Xalqaro to‘lov (tez orada)

Asosiy menyu

🔄 handleSubscriptionPayment(ctx: BotContext)
Vazifasi:
Foydalanuvchi obuna asosidagi avtomatik to‘lovni tanlaganida ishlaydi.

Amallar:

Shartlarga rozi bo‘lganlik tekshiriladi.

Foydalanuvchi va tanlangan sport turi olinadi.

SubscriptionFlowTracker ga yozuv qo‘shiladi.

getSubscriptionPaymentMethodKeyboard() orqali tugmalar ko‘rsatiladi.

🔘 getOneTimePaymentMethodKeyboard(...)
Vazifasi:
Bir martalik to‘lov uchun tegishli to‘lov variantlari tugmalarini qaytaradi.

Variantlar:

Uzcard/Humo

Payme

Click

Orqaga

Asosiy menyu

🔁 getSubscriptionPaymentMethodKeyboard(...)
Vazifasi:
Obuna asosidagi to‘lov uchun tugmalarni shakllantiradi.

Xususiyatlari:

Agar foydalanuvchining oldindan saqlangan kartasi bo‘lsa, shu orqali to‘lov qilish imkoniyati ko‘rsatiladi.

Aks holda: Uzcard, Click, Payme tugmalari chiqadi.

Orqaga va Asosiy menyu tugmalari mavjud.

💾 getUserExistingCards(userId: string)
Vazifasi:
Foydalanuvchining saqlangan kartalarini olib keladi.

Shartlar:

verified: true

isDeleted: false

✅ confirmSubscription(ctx: BotContext)
Vazifasi:
To‘lov amalga oshgach, obunani tasdiqlaydi va kanalga havola beradi.

Amallar:

Shartlarga rozi bo‘lganlik tekshiriladi.

Foydalanuvchi topiladi.

Foydalanuvchi allaqachon obuna bo‘lgan bo‘lsa, shu haqda xabar chiqadi.

Yangi obuna yaratiladi.

Kanalga ulanish havolasi ko‘rsatiladi.

🔗 getFootballLink() va getWrestlingLink()
Vazifasi:
Futbol va kurash (wrestling) Telegram kanallariga maxsus havola (invite link) yaratadi.

Qo‘llanilishi:

member_limit: 1: faqat 1 kishi foydalanishi mumkin

expire_date: 0: muddatsiz (cheklanmagan)

creates_join_request: false: foydalanuvchi darhol kanalga qo‘shiladi, admin tasdiqlashi shart emas

👤 createUserIfNotExist(ctx: BotContext)
Vazifasi:
Foydalanuvchi birinchi marta botga kirganda uni bazaga qo‘shish yoki yangilash.

Amallar:

telegramId orqali foydalanuvchini tekshiradi.

Topilmasa: yangi foydalanuvchi yaratadi.

Username o‘zgargan bo‘lsa — yangilaydi.

👮 handleAdminCommand(ctx: BotContext)
Vazifasi:
Admin uchun statistikani ko‘rsatish buyrug‘i.

Xususiyatlar:

Faqat ADMIN_IDS ro‘yxatidagi foydalanuvchilar foydalanishi mumkin.

showAdminStats() funksiyasini chaqiradi.

📊 showAdminStats(ctx: BotContext)
Vazifasi:
Botdagi umumiy foydalanuvchilar va to‘lovlar statistikasini ko‘rsatadi.

Ko‘rsatiladigan statistika:
👥 Foydalanuvchilar:
Umumiy foydalanuvchilar soni

Faol foydalanuvchilar

Bugun yangi foydalanuvchilar

Bugun kanalga obuna bo‘lganlar

Obunasi tugaganlar

Obunasi 3 kun ichida tugaydiganlar

Umuman obuna bo‘lmaganlar

💳 Karta statistikasi:
Jami karta qo‘shganlar (Payme, Click, Uzcard bo‘yicha)

Bugungi qo‘shilgan kartalar (har biri bo‘yicha)

🔄 Avtomatik obuna statistikasi:
Bugun "Avtomatik to‘lov" tugmasini bosganlar

Bugun karta qo‘shganlar (autopay uchun)

💸 To‘lovlar:
Bugun amalga oshirilgan pullik obunalar soni

❌ handleDeleteCard(ctx: BotContext)
Vazifasi:
Foydalanuvchining botdagi to‘lov kartasini to‘lov tizimidan va bazadan o‘chirish.

Amallar:
Foydalanuvchi va kartani aniqlaydi.

Karta turiga qarab to‘lov tizimidan o‘chirish:

Click: clickSubsApiService.deleteCardToken()

Payme: paymeSubsApiService.deleteCardToken()

Uzcard: uzcardSubsApiService.deleteCard()

Karta bazadan o‘chiriladi: UserCardsModel.deleteOne(...)


🟦 handleUseExistingCard(ctx, planId)
📝 Vazifasi:
Foydalanuvchi mavjud (saqlangan) kartasi bilan obuna bo‘lishni tanlaganda, shu kartadan foydalanib to‘lovni amalga oshirish yoki bonus berishni amalga oshiradi.

⚙️ Asosiy jarayon:
Foydalanuvchi, karta va tanlangan tarif (plan) ma'lumotlarini olish.

Agar foydalanuvchi bonus olish huquqiga ega bo‘lsa:

UZCARD → handleUzCardEligiblePayment(...)

Boshqa kartalar → handleOtherCardEligiblePayment(...)

Bonusli obunani UserSubscription ga yozadi.

Agar foydalanuvchi bonus olish huquqiga ega bo‘lmasa:

subscriptionService.renewSubscriptionWithCard(...) orqali to‘lov amalga oshiriladi.

Muvaffaqiyatli yoki xatolik bo‘yicha xabar yuboriladi.

🟦 handleShowCards(ctx, userId)
📝 Vazifasi:
Foydalanuvchiga u saqlagan kartalar ro‘yxatini ko‘rsatadi.

🖥️ Natija:
text
Copy
Edit
💳 1. ****5678 (Click)
💳 2. ****1234 (Payme)
📋 Inline tugmalar:
🔙 Orqaga (payment_type_subscription)

🟦 showExistingCardOptions(ctx, userId)
📝 Vazifasi:
Foydalanuvchining saqlangan kartalari mavjud bo‘lsa, tanlash yoki ko‘rish imkonini beradi.

🔍 Qadamlar:
Sport turi (football yoki wrestling) asosida tarifni topadi.

Foydalanuvchida saqlangan kartalar borligini tekshiradi.

Agar yo‘q bo‘lsa: ❌ “Sizda saqlangan karta yo‘q” xabari.

Agar mavjud bo‘lsa:

“👁 Kartalarni ko‘rish”

“💳 Mavjud kartadan foydalanish”

“🔙 Orqaga”

“🏠 Asosiy menyu”

🟦 getPlanBySport(selectedSport)
📝 Vazifasi:
Berilgan sport turi (football yoki wrestling) bo‘yicha tarif (plan) topadi.

🔁 Qaytadi:
Plan.findOne({name: 'Futbol'}) yoki Plan.findOne({name: 'Yakka kurash'})

🟦 handleUzCardEligiblePayment(...)
📝 Vazifasi:
UZCARD kartasi orqali bonus olishga huquqli foydalanuvchilar uchun tegishli sport bo‘yicha obuna jarayonini bajaradi.

🌐 Sportga qarab:
football → handleUzCardSubscriptionSuccess(...)

wrestling → handleUzCardWrestlingSubscriptionSuccess(...)

🟦 handleOtherCardEligiblePayment(...)
📝 Vazifasi:
Click yoki Payme kartasi bilan bonus olishga huquqli foydalanuvchi uchun mos usulni chaqiradi.

🌐 Sportga qarab:
football → handleAutoSubscriptionSuccess(...)

wrestling → handleAutoSubscriptionSuccessForWrestling(...)

🟦 selectedSportChecker(ctx)
📝 Vazifasi:
Foydalanuvchining tanlagan sport turini tekshiradi.

🎯 Agar sport turi belgilanmagan bo‘lsa:
ctx.answerCallbackQuery("Iltimos, avval sport turini tanlang.")

Asosiy menyuni ko‘rsatadi: showMainMenu(ctx)

🌐 Til Tanlash Menyusi
🟩 showlangMenu(ctx)
📝 Vazifasi:
Foydalanuvchiga bot tilini tanlash uchun menyuni ko‘rsatadi.

🌍 Tugmalar:
🇺🇿 O‘zbek tili

🇷🇺 Русский язык

🧠 Xabar:
nginx
Copy
Edit
Iltimos quyidagi tillardan birini tanlang
Пожалуйста, выберите один из следующих языков
🟩 handleSetUzbekLanguage(ctx)
🟩 handleSetRussianLanguage(ctx)
📝 Vazifasi:
Foydalanuvchining tilini uz yoki ru ga sozlaydi va asosiy menyuni ko‘rsatadi.


Payment-providers fileda tolov tizimlariga oid service controller logika yozilgan 


Services fileda loyihaga kerakli boshqa service logikalar yozilgan.
