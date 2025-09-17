import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot, Context, InlineKeyboard, session, SessionFlavor } from 'grammy';
import { config, SubscriptionType } from '../../shared/config';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionMonitorService } from './services/subscription-monitor.service';
import { SubscriptionChecker } from './services/subscription-checker';
import logger from '../../shared/utils/logger';
import { IPlanDocument, Plan } from '../../shared/database/models/plans.model';
import { UserModel } from '../../shared/database/models/user.model';
import { generatePaymeLink } from '../../shared/generators/payme-link.generator';
import {
  ClickRedirectParams,
  getClickRedirectLink,
} from '../../shared/generators/click-redirect-link.generator';
import mongoose from "mongoose";
import { CardType, UserCardsModel } from "../../shared/database/models/user-cards.model";
import { FlowStepType, SubscriptionFlowTracker } from 'src/shared/database/models/subscription.follow.tracker';
import { ClickService } from '../payment-providers/click/click.service';
import { ConfigService } from '@nestjs/config';
import { Transaction, TransactionStatus } from '../../shared/database/models/transactions.model';
import { PaymentService } from './services/payment.service';

interface SessionData {
  pendingSubscription?: {
    type: SubscriptionType;
  };
  hasAgreedToTerms?: boolean;
  selectedService: string;
  subscriptionUserId?: string;
  subscriptionPlanId?: string;
  subscriptionService?: string;
  pendingInvoiceId?: number;
  pendingUserId?: string;
  pendingPlanId?: string;
  waitingForPhoneNumber?: boolean;  // ✅ Telefon raqam kutish flag'i
}

type BotContext = Context & SessionFlavor<SessionData>;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private bot: Bot<BotContext>;
  private subscriptionService: SubscriptionService;
  private subscriptionMonitorService: SubscriptionMonitorService;
  private subscriptionChecker: SubscriptionChecker;
  private readonly ADMIN_IDS = [1487957834, 7554617589, 85939027, 2022496528];

  constructor(
    private readonly clickService: ClickService,  // ✅ DI orqali inject qilish
    private readonly configService: ConfigService, // ✅ ConfigService qo'shish
  ) {
    this.bot = new Bot<BotContext>(config.BOT_TOKEN);
    // PaymentService yaratish
    const paymentService = new PaymentService(this.configService);
    this.subscriptionService = new SubscriptionService(this.bot, paymentService);
    this.subscriptionMonitorService = new SubscriptionMonitorService(this.bot);
    this.subscriptionChecker = new SubscriptionChecker(
      this.subscriptionMonitorService,
    );
    this.setupMiddleware();
    this.setupHandlers();
  }

  async onModuleInit(): Promise<void> {
    // Start the bot asynchronously to avoid blocking application startup
    this.startAsync();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  public async start(): Promise<void> {
    this.subscriptionChecker.start();

    await this.bot.start({
      onStart: () => {
        logger.info('Bot started');
      },
    });
  }

  public async stop(): Promise<void> {
    logger.info('Stopping bot...');
    await this.bot.stop();
  }

  async handleCardAddedWithoutBonus(userId: string, telegramId: number, cardType: CardType, plan: IPlanDocument, username?: string, selectedService?: string) {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        return;
      }

      if (!plan) {
        return;
      }

      user.subscriptionType = 'subscription'
      user.save();

      // Create regular subscription without bonus
      const {
        user: subscription,
        wasKickedOut,
        success
      } = await this.subscriptionService.renewSubscriptionWithCard(
        userId,
        telegramId,
        cardType,
        plan,
        username,
        selectedService
      );

      if (success) {
        const privateLink = await this.getPrivateLink();
        const keyboard = new InlineKeyboard()
          .url("🔗 Kanalga kirish", privateLink.invite_link)
          .row()
          .text("📊 Obuna holati", "check_status")
          .row()
          .text("🔙 Asosiy menyu", "main_menu");

        // Format the end date
        const endDate = new Date(subscription.subscriptionEnd);
        const endDateFormatted = `${endDate.getDate().toString().padStart(2, '0')}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getFullYear()}`;

        let messageText = `✅ To'lov muvaffaqiyatli amalga oshirildi va kartangiz saqlandi!\n\n` +
          `📆 Yangi obuna muddati: ${endDateFormatted} gacha\n\n` +
          `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

        await this.bot.api.sendMessage(
          telegramId,
          messageText,
          {
            reply_markup: keyboard,
            parse_mode: "HTML"
          }
        );

      }

    } catch (error) {
      await this.bot.api.sendMessage(
        telegramId,
        "⚠️ Kartangiz qo'shildi, lekin obunani yangilashda xatolik yuz berdi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
      );
    }


  }
  async handleAutoSubscriptionSuccess(userId: string, telegramId: number, planId: string, username?: string): Promise<void> {
    try {
      const plan = await Plan.findById(planId);

      if (!plan) {
        logger.error(`Plan with name 'Wrestling' not found in handleAutoSubscriptionSuccessForWrestling`);
        return;
      }

      await SubscriptionFlowTracker.create({
        telegramId,
        username,
        userId,
        step: FlowStepType.COMPLETED_SUBSCRIPTION,
      });

      const user = await UserModel.findById(userId);

      if (!user) {
        throw new Error('User not found');
      }


      const { user: subscription } = await this.subscriptionService.createSubscriptionWithCard(
        userId,
        plan,
        username,
        30
      );

      const privateLink = await this.getPrivateLink();
      const keyboard = new InlineKeyboard()
        .url("🔗 Kanalga kirish", privateLink.invite_link)
        .row()
        .text("🔙 Asosiy menyu", "main_menu");

      // Format end date in DD.MM.YYYY format
      const endDateFormatted = `${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}`;


      let messageText = `🎉 Tabriklaymiz! Yulduzlar bashorati obunasi muvaffaqiyatli faollashtirildi!\n\n`;

      messageText += `📆 Obuna muddati: ${endDateFormatted} gacha\n\n`;


      // if (wasKickedOut) {
      //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
      //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
      //     messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
      //         `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
      // } else {
      //     messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
      // }

      messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;


      await this.bot.api.sendMessage(
        telegramId,
        messageText,
        {
          reply_markup: keyboard,
          parse_mode: "HTML"
        }
      );

    } catch (error) {

      // Send error message to user
      await this.bot.api.sendMessage(
        telegramId,
        "⚠️ Avtomatik to'lov faollashtirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning."
      );
    }

  }
  async handlePaymentSuccess(
    userId: string,
    telegramId: number,
    username?: string,
  ): Promise<void> {
    console.log('WATCH! @@@ handlePaymentSuccess is being called! ');

    try {
      const plan = await Plan.findOne({ name: 'Basic' });

      if (!plan) {
        logger.error('No plan found with name "Basic"');
        return;
      }

      const { user: subscription, wasKickedOut } =
        await this.subscriptionService.createSubscription(
          userId,
          plan,
          username,
        );

      const privateLink = await this.getPrivateLink();
      const keyboard = new InlineKeyboard()
        .url('🔗 Kanalga kirish', privateLink.invite_link)
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');

      let messageText =
        `🎉 Tabriklaymiz! To'lov muvaffaqiyatli amalga oshirildi!\n\n` +
        `⏰ Obuna tugash muddati: ${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}\n\n`;

      if (wasKickedOut) {
        await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
        messageText +=
          `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
          `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
      } else {
        messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
      }

      await this.bot.api.sendMessage(telegramId, messageText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
      console.log('WATCH! @@@ handlePaymentSuccess sent the message');
    } catch (error) {
      logger.error('Payment success handling error:', error);
      await this.bot.api.sendMessage(
        telegramId,
        "⚠️ To'lov amalga oshirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning.",
      );
    }
  }

  async handleSubscriptionSuccess(
    userId: string,
    planId: string,
    bonusDays: number,
    selectedService: string,
  ): Promise<void> {
    let telegramId: number | undefined;

    logger.warn(
      `Selected service in handleSubscriptionSuccess ${selectedService}`,
    );
    try {
      const plan = await Plan.findById(planId);
      if (!plan) {
        logger.error('No plan found with name "Basic"');
        return;
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        logger.error(`User not found with ID: ${userId}`);
        return;
      }

      telegramId = user.telegramId;
      if (!telegramId) {
        logger.error(`Telegram ID not found for user: ${userId}`);
        return;
      }

      const { user: subscription, wasKickedOut } =
        await this.subscriptionService.createBonusSubscription(
          userId,
          plan,
          bonusDays,
          user.username,
          'yulduz',
        );

      const privateLink = await this.getPrivateLink();
      const keyboard = new InlineKeyboard()
        .url('🔗 Kanalga kirish', privateLink.invite_link)
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');

      const bonusEndFormatted = `${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}`;

      let messageText =
        `🎉 Tabriklaymiz! UzCard orqali ${plan.name} uchun obuna muvaffaqiyatli faollashtirildi!\n\n` +
        `🎁 ${bonusDays} kunlik bonus: ${bonusEndFormatted} gacha\n\n`;

      if (wasKickedOut) {
        await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
        messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. `;
      }

      messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

      await this.bot.api.sendMessage(telegramId, messageText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });

      logger.info(
        `UzCard subscription success handled for user ${userId} with ${bonusDays} bonus days`,
      );
    } catch (error) {
      logger.error(`Error in handleUzCardSubscriptionSuccess: ${error}`);
      if (telegramId) {
        await this.bot.api.sendMessage(
          telegramId,
          "⚠️ UzCard orqali obunani faollashtirishda xatolik. Iltimos, administrator bilan bog'laning.",
        );
      }
    }
  }

  async handlePaymentSuccessForUzcard(
    userId: string,
    telegramId: number,
    username?: string,
    // fiscalQr?: string | undefined,
    selectedService?: string,
  ): Promise<void> {
    logger.info(`Selected sport on handlePaymentSuccess: ${selectedService}`);
    try {
      const plan = await Plan.findOne({ $or: [{ selectedName: selectedService }, { name: selectedService }] });

      if (!plan) {
        return;
      }

      const subscription = await this.subscriptionService.createSubscription(
        userId,
        plan,
        username,
      );

      let messageText: string = '';

      const privateLink = await this.getPrivateLink();
      const keyboard = new InlineKeyboard()
        .url('🔗 Kanalga kirish', privateLink.invite_link)
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');

      // if (fiscalQr) {
      //   keyboard.row().url("🧾 Chekni ko'rish", fiscalQr);
      // }

      const subscriptionEndDate = subscription.user.subscriptionEnd;

      messageText =
        `🎉 Tabriklaymiz! Yulduz Bashorati uchun to'lov muvaffaqiyatli amalga oshirildi!\n\n` +
        `⏰ Obuna tugash muddati: ${subscriptionEndDate.getDate().toString().padStart(2, '0')}.${(subscriptionEndDate.getMonth() + 1).toString().padStart(2, '0')}.${subscriptionEndDate.getFullYear()}\n\n`;

      messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

      // if (fiscalQr) {
      //   messageText += `\n\n📋 To'lov cheki QR kodi mavjud. Chekni ko'rish uchun quyidagi tugmani bosing.`;
      // }

      await UserModel.updateOne(
        { telegramId: telegramId },
        { $set: { subscribedTo: selectedService } },
      );

      const user1 = await UserModel.findOne({
        telegramId: telegramId,
      });

      // @ts-ignore
      logger.info(`User updated with subscribedTo: ${user1.subscribedTo}`);

      await this.bot.api.sendMessage(telegramId, messageText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    } catch (error) {
      logger.error(`Error in handlePaymentSuccessForUzcard: ${error}`);
      await this.bot.api.sendMessage(
        telegramId,
        "⚠️ To'lov amalga oshirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning. @sssupporttbot",
      );
    }
  }


  private async startAsync(): Promise<void> {
    try {
      await this.start();
      // ✅ Payment status checker ni ishga tushirish
      this.startPaymentStatusChecker();
    } catch (error) {
      logger.error('Failed to start bot:', error);
    }
  }

  // ... rest of your methods remain the same ...
  private setupMiddleware(): void {
    this.bot.use(
      session({
        initial(): SessionData {
          return {
            selectedService: 'yulduz',
            hasAgreedToTerms: false, // Initialize as false by default
          };
        },
      }),
    );
    this.bot.use((ctx, next) => {
      logger.info(`user chatId: ${ctx.from?.id}`);
      return next();
    });

    this.bot.catch((err) => {
      logger.error('Bot error:', err);
    });
  }

  private setupHandlers(): void {
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('admin', this.handleAdminCommand.bind(this));
    this.bot.on('callback_query', this.handleCallbackQuery.bind(this));
    this.bot.on('message:text', this.handleTextMessage.bind(this));  // ✅ Telefon raqam uchun
  }

  private async handleCallbackQuery(ctx: BotContext): Promise<void> {
    if (!ctx.callbackQuery?.data) return;

    const data = ctx.callbackQuery.data;
    if (!data) return;

    if (data === 'main_menu') {
      ctx.session.hasAgreedToTerms = false;
    }

    // Handle invoice status check
    if (data.startsWith('check_invoice_')) {
      const invoiceId = parseInt(data.replace('check_invoice_', ''));
      await this.handleInvoiceStatusCheck(ctx, invoiceId);
      return;
    }

    // Handle UzCard onetime payments
    if (data.startsWith('uzcard_ot_')) {
      await ctx.answerCallbackQuery("Uzcard to'lovi tez orada ishga tushiriladi!");
      return;
    }

    // Handle subscription payments with shorter callback data
    if (data === 'sub_uzcard' || data === 'sub_click' || data === 'sub_payme') {
      const paymentType = data.replace('sub_', '');
      const userId = ctx.session.subscriptionUserId;
      const planId = ctx.session.subscriptionPlanId;
      const selectedService = ctx.session.subscriptionService;

      if (!userId || !planId || !selectedService) {
        await ctx.answerCallbackQuery("Session ma'lumotlari topilmadi. Iltimos, /start tugmasini bosib, jarayonni qaytadan boshlang.");
        await this.showMainMenu(ctx);
        return;
      }

      // Get the payment URL and redirect user to payment page
      try {
        let paymentUrl: string;
        let bonusDays: number;

        switch (paymentType) {
          case 'uzcard':
            bonusDays = 30;
            paymentUrl = `${config.BASE_URL}/api/uzcard-api/add-card?userId=${userId}&planId=${planId}&selectedService=${selectedService}&bonusDays=${bonusDays}`;
            break;
          case 'click':
            bonusDays = 20;
            paymentUrl = `${config.BASE_URL}/api/click-subs-api/payment?userId=${userId}&planId=${planId}&selectedService=${selectedService}&bonusDays=${bonusDays}`;
            break;
          case 'payme':
            bonusDays = 10;
            paymentUrl = `${config.BASE_URL}/api/payme-subs-api/payment?userId=${userId}&planId=${planId}&selectedService=${selectedService}&bonusDays=${bonusDays}`;
            break;
          default:
            await ctx.answerCallbackQuery("Noma'lum to'lov turi.");
            return;
        }

        // Create keyboard with payment URL
        const keyboard = new InlineKeyboard()
          .url(`💳 ${paymentType.toUpperCase()} orqali to'lash`, paymentUrl)
          .row()
          .text('🔙 Orqaga', 'back_to_payment_types')
          .row()
          .text('🏠 Asosiy menyu', 'main_menu');

        // Log the payment URL for testing (when not using public tunnel)
        console.log(`\n🔗 PAYMENT URL for testing: ${paymentUrl}\n`);
        console.log(`Copy this URL and open it in your browser for testing.\n`);

        const paymentTypeText = paymentType === 'uzcard' ? 'Uzcard/Humo' :
          paymentType === 'click' ? 'Click' : 'Payme';

        await ctx.editMessageText(
          `💳 <b>${paymentTypeText} obuna to'lovi</b>\n\n` +
          `🎁 <b>${bonusDays} kunlik bonus bilan!</b>\n\n` +
          `Quyidagi tugma orqali kartangizni qo'shing va avtomatik to'lovni yoqing. ` +
          `Har 30 kunda avtomatik to'lov amalga oshiriladi.\n\n` +
          `✅ Birinchi ${bonusDays} kun - <b>BEPUL!</b>`,
          {
            reply_markup: keyboard,
            parse_mode: 'HTML',
          }
        );

        await ctx.answerCallbackQuery();
      } catch (error) {
        logger.error(`Error in subscription payment ${paymentType}:`, error);
        await ctx.answerCallbackQuery("To'lov sahifasini ochishda xatolik yuz berdi.");
      }
      return;
    }

    const handlers: { [key: string]: (ctx: BotContext) => Promise<void> } = {
      payment_type_onetime: this.handleOneTimePayment.bind(this),
      payment_type_subscription: this.handleSubscriptionPayment.bind(this),
      back_to_payment_types: this.showPaymentTypeSelection.bind(this),
      subscribe: this.handleSubscribeCallback.bind(this),
      check_status: this.handleStatus.bind(this),
      renew: this.handleRenew.bind(this),
      main_menu: this.showMainMenu.bind(this),
      confirm_subscribe_basic: this.confirmSubscription.bind(this),
      agree_terms: this.handleAgreement.bind(this),

      not_supported_international: async (ctx) => {
        await ctx.answerCallbackQuery({
          text: "⚠️ Kechirasiz, hozircha bu to'lov turi mavjud emas.",
          show_alert: true,
        });
      },
    };

    const handler = handlers[data];
    if (handler) {
      await handler(ctx);
    }
  }

  private async showMainMenu(ctx: BotContext): Promise<void> {
    ctx.session.hasAgreedToTerms = false;

    const keyboard = new InlineKeyboard()
      .text("🎯 Obuna bo'lish", 'subscribe')
      .row()
      .text('📊 Obuna holati', 'check_status')
      .row()
      .text('🔄 Obunani yangilash', 'renew');

    const message = `Assalomu alaykum, ${ctx.from?.first_name}! 👋\n\n Yulduzlar bashorati premium kontentiga xush kelibsiz 🏆\n\nQuyidagi tugmalardan birini tanlang:`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    } else {
      await ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    }
  }

  private async handleStart(ctx: BotContext): Promise<void> {
    ctx.session.hasAgreedToTerms = false;
    await this.createUserIfNotExist(ctx);
    await this.showMainMenu(ctx);
  }

  private async handleStatus(ctx: BotContext): Promise<void> {
    try {
      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId });

      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      if (!user.subscriptionStart && !user.subscriptionEnd) {
        const keyboard = new InlineKeyboard()
          .text("🎯 Obuna bo'lish", 'subscribe')
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        await ctx.editMessageText(
          "Siz hali obuna bo'lmagansiz 🤷‍♂️\nObuna bo'lish uchun quyidagi tugmani bosing:",
          { reply_markup: keyboard },
        );
        return;
      }

      const subscription = await this.subscriptionService.getSubscription(
        user._id as string,
      );

      if (!subscription) {
        const keyboard = new InlineKeyboard()
          .text("🎯 Obuna bo'lish", 'subscribe')
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        await ctx.editMessageText(
          "Hech qanday obuna topilmadi 🤷‍♂️\nObuna bo'lish uchun quyidagi tugmani bosing:",
          { reply_markup: keyboard },
        );
        return;
      }

      const status = subscription.isActive ? '✅ Faol' : '❌ Muddati tugagan';
      const expirationLabel = subscription.isActive
        ? '⏰ Obuna tugash muddati:'
        : '⏰ Obuna tamomlangan sana:';

      let subscriptionStartDate = 'Mavjud emas';
      let subscriptionEndDate = 'Mavjud emas';

      if (subscription.subscriptionStart) {
        const d = subscription.subscriptionStart;
        subscriptionStartDate = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
      }
      if (subscription.subscriptionEnd) {
        const d = subscription.subscriptionEnd;
        subscriptionEndDate = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
      }

      const message = `🎫 <b>Obuna ma'lumotlari:</b>\n
📅 Holati: ${status}
📆 Obuna bo'lgan sana: ${subscriptionStartDate}
${expirationLabel} ${subscriptionEndDate}`;

      const keyboard = new InlineKeyboard();

      if (subscription.isActive) {
        const privateLink = await this.getPrivateLink();
        keyboard.row();
        keyboard.url('🔗 Kanalga kirish', privateLink.invite_link);
      } else {
        keyboard.text("🎯 Qayta obuna bo'lish", 'subscribe');
      }

      keyboard.row().text('🔙 Asosiy menyu', 'main_menu');

      await ctx.editMessageText(message, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    } catch (error) {
      logger.error('Status check error:', error);
      await ctx.answerCallbackQuery(
        'Obuna holatini tekshirishda xatolik yuz berdi.',
      );
    }
  }

  private async handleSubscribeCallback(ctx: BotContext): Promise<void> {
    try {
      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const existingSubscription =
        await this.subscriptionService.getSubscription(user._id as string);
      if (existingSubscription?.isActive) {
        const keyboard = new InlineKeyboard().text(
          '📊 Obuna holati',
          'check_status',
        );

        await ctx.editMessageText(
          `⚠️ Siz allaqachon obuna bo'lgansiz ✅\n\nObuna tugash muddati: ${existingSubscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(existingSubscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${existingSubscription.subscriptionEnd.getFullYear()}`,
          { reply_markup: keyboard },
        );
        return;
      }

      ctx.session.hasAgreedToTerms = false;

      const keyboard = new InlineKeyboard()
        .url(
          '📄 Foydalanish shartlari',
          'https://telegra.ph/Yulduzlar-Bashorati-Premium--OMMAVIY-OFERTA-06-26',
        )
        .row()
        .text('✅ Qabul qilaman', 'agree_terms')
        .row()
        .text('❌ Bekor qilish', 'main_menu');

      await ctx.editMessageText(
        '📜 <b>Foydalanish shartlari va shartlar:</b>\n\n' +
        "Iltimos, obuna bo'lishdan oldin foydalanish shartlari bilan tanishib chiqing.\n\n" +
        'Tugmani bosib foydalanish shartlarini o\'qishingiz mumkin. Shartlarni qabul qilganingizdan so\'ng "Qabul qilaman" tugmasini bosing.',
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      logger.error('Subscription plan display error:', error);
      await ctx.answerCallbackQuery(
        "Obuna turlarini ko'rsatishda xatolik yuz berdi.",
      );
    }
  }

  private async handleAgreement(ctx: BotContext): Promise<void> {
    try {
      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      ctx.session.hasAgreedToTerms = true;

      await this.showPaymentTypeSelection(ctx);
    } catch (error) {
      await ctx.answerCallbackQuery(
        "To'lov turlarini ko'rsatishda xatolik yuz berdi.",
      );
    }
  }

  private async confirmSubscription(ctx: BotContext): Promise<void> {
    try {
      if (!ctx.session.hasAgreedToTerms) {
        await this.handleSubscribeCallback(ctx);
        return;
      }

      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId: telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const plan = await Plan.findOne({
        name: 'Basic',
      });

      if (!plan) {
        logger.error('No plan found with name "Basic"');
        return;
      }

      try {
        const { user: subscription } =
          await this.subscriptionService.createSubscription(
            user._id as string,
            plan,
            ctx.from?.username,
          );

        const privateLink = await this.getPrivateLink();
        const keyboard = new InlineKeyboard()
          .url('🔗 Kanalga kirish', privateLink.invite_link)
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        const messageText =
          `🎉 Tabriklaymiz! Siz muvaffaqiyatli obuna bo'ldingiz!\n\n` +
          `⏰ Obuna tugash muddati: ${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}\n\n` +
          `Quyidagi havola orqali kanalga kirishingiz mumkin:\n\n`;

        await ctx.editMessageText(messageText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'User already has an active subscription'
        ) {
          const keyboard = new InlineKeyboard()
            .text('📊 Obuna holati', 'check_status')
            .row()
            .text('🔙 Asosiy menyu', 'main_menu');

          await ctx.editMessageText(
            '⚠️ Siz allaqachon faol obunaga egasiz. Obuna holatini tekshirish uchun quyidagi tugmani bosing:',
            { reply_markup: keyboard },
          );
          return;
        }
        logger.error('Subscription confirmation error:', error);
        await ctx.answerCallbackQuery(
          'Obunani tasdiqlashda xatolik yuz berdi.',
        );
      }
    } catch (error) {
      logger.error('Subscription confirmation error:', error);
      await ctx.answerCallbackQuery('Obunani tasdiqlashda xatolik yuz berdi.');
    }
  }

  private async getPrivateLink() {
    try {
      logger.info(
        'Generating private channel invite link with channelId: ',
        config.CHANNEL_ID,
      );
      const link = await this.bot.api.createChatInviteLink(config.CHANNEL_ID, {
        member_limit: 1,
        expire_date: 0,
        creates_join_request: false,
      });
      logger.info('Private channel invite link:', link.invite_link);
      return link;
    } catch (error) {
      logger.error('Error generating channel invite link:', error);
      throw error;
    }
  }

  private async handleRenew(ctx: BotContext): Promise<void> {
    try {
      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const existingSubscription =
        await this.subscriptionService.getSubscription(user._id as string);

      if (!existingSubscription?.isActive || !existingSubscription) {
        const keyboard = new InlineKeyboard()
          .text("🎯 Obuna bo'lish", 'subscribe')
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        await ctx.editMessageText(
          "⚠️ Siz hali obuna bo'lmagansiz. Obuna bo'lish uchun quyidagi tugmani bosing:",
          { reply_markup: keyboard },
        );
        return;
      }

      const now = new Date();
      const daysUntilExpiration = Math.ceil(
        (existingSubscription.subscriptionEnd.getTime() - now.getTime()) /
        (1000 * 60 * 60 * 24),
      );

      if (existingSubscription.isActive && daysUntilExpiration > 3) {
        const keyboard = new InlineKeyboard()
          .text('📊 Obuna holati', 'check_status')
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        await ctx.editMessageText(
          `⚠️ Sizning obunangiz hali faol va ${daysUntilExpiration} kundan so'ng tugaydi.\n\n` +
          `Obunani faqat muddati tugashiga 3 kun qolganda yoki muddati tugagandan so'ng yangilash mumkin.`,
          { reply_markup: keyboard },
        );
        return;
      }

      ctx.session.hasAgreedToTerms = false;

      const keyboard = new InlineKeyboard()
        .url(
          '📄 Foydalanish shartlari',
          'https://telegra.ph/Yulduzlar-Bashorati-Premium--OMMAVIY-OFERTA-06-26',
        )
        .row()
        .text('✅ Qabul qilaman', 'agree_terms')
        .row()
        .text('❌ Bekor qilish', 'main_menu');

      await ctx.editMessageText(
        '📜 <b>Foydalanish shartlari va shartlar:</b>\n\n' +
        'Iltimos, obunani yangilashdan oldin foydalanish shartlari bilan tanishib chiqing.\n\n' +
        'Tugmani bosib foydalanish shartlarini o\'qishingiz mumkin. Shartlarni qabul qilganingizdan so\'ng "Qabul qilaman" tugmasini bosing.',
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      logger.error('Renewal error:', error);
      await ctx.answerCallbackQuery('Obunani yangilashda xatolik yuz berdi.');
    }
  }

  private async createUserIfNotExist(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username;

    if (!telegramId) {
      return;
    }

    const user = await UserModel.findOne({ telegramId });
    if (!user) {
      const newUser = new UserModel({
        telegramId,
        username,
      });
      await newUser.save();
    } else if (username && user.username !== username) {
      user.username = username;
      await user.save();
    }
  }

  private async showPaymentTypeSelection(ctx: BotContext): Promise<void> {
    try {
      // Check if user has agreed to terms before proceeding
      if (!ctx.session.hasAgreedToTerms) {
        await this.handleSubscribeCallback(ctx);
        return;
      }

      const keyboard = new InlineKeyboard()
        .text('🔄 Obuna | 30 kun bepul', 'payment_type_subscription')
        .row()
        .text("💰 Bir martalik to'lov", 'payment_type_onetime')
        .row()
        .text("🌍 Xalqaro to'lov (Tez kunda)", 'not_supported_international')
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');

      await ctx.editMessageText(
        "🎯 Iltimos, to'lov turini tanlang:\n\n" +
        "💰 <b>Bir martalik to'lov</b> - 30 kun uchun.\n\n" +
        "🔄 <b>30 kunlik (obuna)</b> - Avtomatik to'lovlarni yoqish.\n\n" +
        "🌍 <b>Xalqaro to'lov</b> - <i>Tez orada ishga tushuriladi!</i>\n\n" +
        "🎁 <b>Obuna to‘lov turini tanlang va 30 kunlik bonusni qo'lga kiriting!</b>",
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      await ctx.answerCallbackQuery(
        "To'lov turlarini ko'rsatishda xatolik yuz berdi.",
      );
    }
  }

  private async handleOneTimePayment(ctx: BotContext): Promise<void> {
    try {
      if (!ctx.session.hasAgreedToTerms) {
        await this.handleSubscribeCallback(ctx);
        return;
      }

      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId: telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const selectedService = await this.selectedServiceChecker(ctx);

      const keyboard = await this.getOneTimePaymentMethodKeyboard(
        ctx,
        user._id as string,
        selectedService,
      );

      if (!keyboard) {
        await ctx.answerCallbackQuery(
          "To'lov turlarini yaratishda xatolik yuz berdi.",
        );
        return;
      }

      await ctx.editMessageText(
        "💰 <b>Bir martalik to'lov</b>\n\n" +
        "Iltimos, o'zingizga ma'qul to'lov turini tanlang:",
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      logger.error('Error in handleOneTimePayment:', error);
      await ctx.answerCallbackQuery(
        "To'lov turlarini ko'rsatishda xatolik yuz berdi.",
      );
    }
  }

  private async handleSubscriptionPayment(ctx: BotContext): Promise<void> {
    try {
      if (!ctx.session.hasAgreedToTerms) {
        await this.handleSubscribeCallback(ctx);
        return;
      }

      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId: telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const userId = user._id as string;

      await this.selectedServiceChecker(ctx);

      const keyboard = await this.getSubscriptionPaymentMethodKeyboard(
        userId,
        ctx,
      );

      await ctx.editMessageText(
        "🔄 <b>Avtomatik to'lov (obuna)</b>\n\n" +
        "Iltimos, to'lov tizimini tanlang. Har 30 kunda to'lov avtomatik ravishda amalga oshiriladi:",
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );
    } catch (error) {
      await ctx.answerCallbackQuery(
        "To'lov turlarini ko'rsatishda xatolik yuz berdi.",
      );
    }
  } private async getOneTimePaymentMethodKeyboard(
    ctx: BotContext,
    userId: string,
    selectedService?: string,
  ) {
    try {
      const selectedService = await this.selectedServiceChecker(ctx);

      const plan = await Plan.findOne({ $or: [{ selectedName: selectedService }, { name: selectedService }] });
      if (!plan) {
        logger.error(`No plan found with selectedService: ${selectedService} in getOneTimePaymentMethodKeyboard`);
        await ctx.answerCallbackQuery('Tarif rejasi topilmadi. Iltimos, /start orqali qaytadan urining.');
        await this.showMainMenu(ctx);
        return;
      }

      logger.info(`Found plan: ${plan.name} with price: ${plan.price}`);

      const redirectURLParams: ClickRedirectParams = {
        userId: userId,
        planId: plan._id as string,
        amount: plan.price as number,
      };

      const paymeCheckoutPageLink = generatePaymeLink({
        planId: plan._id as string,
        amount: plan.price,
        userId: userId,
      });

      const clickUrl = getClickRedirectLink(redirectURLParams);

      // Shorten the callback data to avoid BUTTON_DATA_INVALID error (max 64 chars)
      const shortUserId = userId.slice(-8); // Last 8 characters 
      const shortPlanId = plan._id.toString().slice(-8); // Last 8 characters

      return new InlineKeyboard()
        .text('📲 Uzcard orqali to\'lash', `uzcard_ot_${shortUserId}_${shortPlanId}`)
        .row()
        .url("📲 Payme orqali to'lash", paymeCheckoutPageLink)
        .row()
        .url("💳 Click orqali to'lash", clickUrl)
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');
    } catch (error) {
      logger.error('Error in getOneTimePaymentMethodKeyboard:', error);

      // Fallback keyboard
      const keyboard = new InlineKeyboard()
        .text('⚠️ To\'lov turlarida xatolik', 'payment_error')
        .row()
        .text('🔙 Asosiy menyu', 'main_menu');

      return keyboard;
    }
  }

  private async getSubscriptionPaymentMethodKeyboard(
    userId: string,
    ctx: BotContext,
  ) {
    try {
      const selectedService = await this.selectedServiceChecker(ctx);

      const plan = await Plan.findOne({ $or: [{ selectedName: selectedService }, { name: selectedService }] });
      if (!plan) {
        logger.error(`No plan found with selectedService: ${selectedService} in getSubscriptionPaymentMethodKeyboard`);
        await ctx.answerCallbackQuery('Tarif rejasi topilmadi. Iltimos, /start orqali qaytadan urining.');
        await this.showMainMenu(ctx);
        return;
      }

      // Store subscription info in session for shorter callback data
      ctx.session.subscriptionUserId = userId;
      ctx.session.subscriptionPlanId = plan._id.toString();
      ctx.session.subscriptionService = selectedService;

      const keyboard = new InlineKeyboard();

      keyboard
        .text('🏦 Uzcard/Humo (30 kun bepul)', 'sub_uzcard')
        .row()
        .text('💳 Click (20 kun bepul)', 'sub_click')
        .row()
        .text('📲 Payme (10 kunlik bonus)', 'sub_payme')
        .row()
        .text('🔙 Orqaga', 'back_to_payment_types')
        .row()
        .text('🏠 Asosiy menyu', 'main_menu');

      return keyboard;
    } catch (error) {
      logger.error('Error in getSubscriptionPaymentMethodKeyboard:', error);

      // Fallback keyboard
      const keyboard = new InlineKeyboard();
      keyboard
        .text('⚠️ To\'lov turlarida xatolik', 'payment_error')
        .row()
        .text('🔙 Orqaga', 'back_to_payment_types')
        .row()
        .text('🏠 Asosiy menyu', 'main_menu');

      return keyboard;
    }
  }

  private async handleAdminCommand(ctx: BotContext): Promise<void> {
    logger.info(`Admin command issued by user ID: ${ctx.from?.id}`);

    if (!this.ADMIN_IDS.includes(ctx.from?.id || 0)) {
      logger.info(`Authorization failed for ID: ${ctx.from?.id}`);
      return;
    }

    const totalUsers = await UserModel.countDocuments();
    const activeUsers = await UserModel.countDocuments({ isActive: true });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTimestamp = Math.floor(today.getTime() / 1000);

    const newUsersToday = await UserModel.countDocuments({
      _id: {
        $gt: new mongoose.Types.ObjectId(todayTimestamp),
      },
    });

    const newSubscribersToday = await UserModel.countDocuments({
      subscriptionStart: { $gte: today },
      isActive: true,
    });

    const expiredSubscriptions = await UserModel.countDocuments({
      isActive: false,
      subscriptionEnd: { $exists: true, $ne: null },
    });

    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const expiringIn3Days = await UserModel.countDocuments({
      subscriptionEnd: {
        $gte: new Date(),
        $lte: threeDaysFromNow,
      },
      isActive: true,
    });

    const neverSubscribed = await UserModel.countDocuments({
      $or: [
        { subscriptionStart: { $exists: false } },
        { subscriptionStart: null },
      ],
    });

    //Autosubscription qilinmadi keyin qilaman
    const totalCardStats = await UserCardsModel.aggregate([
      { $match: { verified: true } },
      {
        $group: {
          _id: '$cardType',
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCards = totalCardStats.reduce((acc, cur) => acc + cur.count, 0);
    const totalCardBreakdown: Record<string, number> = {
      click: 0,
      uzcard: 0,
      payme: 0,
    };
    totalCardStats.forEach((stat) => {
      totalCardBreakdown[stat._id] = stat.count;
    });

    // Cards added today
    const todayCardStats = await UserCardsModel.aggregate([
      {
        $match: {
          verified: true,
          createdAt: { $gte: today },
        },
      },
      {
        $group: {
          _id: '$cardType',
          count: { $sum: 1 },
        },
      },
    ]);

    const todayCardTotal = todayCardStats.reduce(
      (acc, cur) => acc + cur.count,
      0,
    );
    const todayCardBreakdown: Record<string, number> = {
      click: 0,
      uzcard: 0,
      payme: 0,
    };
    todayCardStats.forEach((stat) => {
      todayCardBreakdown[stat._id] = stat.count;
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const completedSubscription = await UserCardsModel.countDocuments({
      verified: true,
      createdAt: { $gte: startOfDay },
    });

    //

    const statsMessage = `📊 <b>Bot statistikasi</b>: \n\n` +
      `👥 Umumiy foydalanuvchilar: ${totalUsers} \n` +
      `✅ Umumiy aktiv foydalanuvchilar: ${activeUsers} \n` +
      `🆕 Bugun botga start berganlar: ${newUsersToday} \n` +
      `💸 Bugun kanalga qo'shilgan foydalanuvchilar: ${newSubscribersToday} \n` +
      `📉 Obunasi tugaganlar: ${expiredSubscriptions} \n` +
      `⏳ Obunasi 3 kun ichida tugaydiganlar: ${expiringIn3Days} \n` +
      `🚫 Hech qachon obuna bo'lmaganlar: ${neverSubscribed} \n\n` +

      `📊 <b>Avtomatik to'lov statistikasi (bugun)</b>: \n\n` +
      `✅ Karta qo'shganlar: ${completedSubscription} \n\n` +

      `💳 <b>Qo'shilgan kartalar statistikasi</b>: \n\n` +
      `📦 Umumiy qo'shilgan kartalar: ${totalCards} \n` +
      ` 🔵 Uzcard: ${totalCardBreakdown.uzcard} \n` +
      ` 🟡 Click: ${totalCardBreakdown.click} \n` +
      ` 🟣 Payme: ${totalCardBreakdown.payme} \n\n` +
      `📅 <u>Bugun qo'shilgan kartalar</u>: ${todayCardTotal} \n` +
      ` 🔵 Uzcard: ${todayCardBreakdown.uzcard} \n` +
      ` 🟡 Click: ${todayCardBreakdown.click} \n` +
      ` 🟣 Payme: ${todayCardBreakdown.payme} \n\n\n`;

    try {
      // await ctx.reply('Admin command executed successfully.');
      await ctx.reply(statsMessage, {
        parse_mode: "HTML"
      })
    } catch (error) {
      logger.error('Error handling admin command:', error);
      await ctx.reply(
        '❌ Error processing admin command. Please try again later.',
      );
    }
  }


  private async handleDevTestSubscribe(ctx: BotContext): Promise<void> {
    try {
      const telegramId = ctx.from?.id;
      const user = await UserModel.findOne({ telegramId });
      if (!user) {
        await ctx.answerCallbackQuery(
          "Foydalanuvchi ID'sini olishda xatolik yuz berdi.",
        );
        return;
      }

      const plan = await Plan.findOne({
        name: 'Basic',
      });

      if (!plan) {
        logger.error('No plan found with name "Basic"');
        return;
      }

      try {
        const { user: subscription, wasKickedOut } =
          await this.subscriptionService.createSubscription(
            user._id as string,
            plan,
            ctx.from?.username,
          );

        if (wasKickedOut && telegramId) {
          await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
        }

        const privateLink = await this.getPrivateLink();
        const keyboard = new InlineKeyboard()
          .url('🔗 Kanalga kirish', privateLink.invite_link)
          .row()
          .text('🔙 Asosiy menyu', 'main_menu');

        let messageText =
          `🎉 DEV TEST: Muvaffaqiyatli obuna bo'ldingiz!\n\n` +
          `⏰ Obuna tugash muddati: ${subscription.subscriptionEnd.toLocaleDateString()}\n\n` +
          `[DEV MODE] To'lov talab qilinmadi\n\n`;

        if (wasKickedOut) {
          messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. `;
        }

        messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

        await ctx.editMessageText(messageText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'User already has an active subscription'
        ) {
          const keyboard = new InlineKeyboard()
            .text('📊 Obuna holati', 'check_status')
            .row()
            .text('🔙 Asosiy menyu', 'main_menu');

          await ctx.editMessageText(
            '⚠️ Siz allaqachon faol obunaga egasiz. Obuna holatini tekshirish uchun quyidagi tugmani bosing:',
            { reply_markup: keyboard },
          );
          return;
        }
        logger.error('Dev test subscription error:', error);
        await ctx.answerCallbackQuery(
          'Obunani tasdiqlashda xatolik yuz berdi.',
        );
      }
    } catch (error) {
      logger.error('Dev test subscription error:', error);
      await ctx.answerCallbackQuery(
        'Dev test obunasini yaratishda xatolik yuz berdi.',
      );
    }
  }

  private async selectedServiceChecker(ctx: BotContext) {
    let selectedService = ctx.session.selectedService;

    // If selectedService is undefined, set default value
    if (selectedService === undefined || selectedService === null) {
      logger.warn('SelectedService was undefined, setting default to yulduz');
      ctx.session.selectedService = 'yulduz';
      selectedService = 'yulduz';
    }

    logger.info(`Selected service: ${selectedService}`);
    return selectedService;
  }

  private async handleClickInvoicePayment(ctx: BotContext, planId: string, userId: string): Promise<void> {
    try {
      const user = await UserModel.findById(userId);
      const plan = await Plan.findById(planId);

      if (!user || !plan) {
        await ctx.answerCallbackQuery('Foydalanuvchi yoki tarif topilmadi.');
        return;
      }

      // Telefon raqam so'rash
      await ctx.editMessageText(
        `💳 <b>Click orqali to'lov</b>\n\n` +
        `💰 Summa: ${plan.price.toLocaleString()} so'm\n` +
        `📋 Plan: ${plan.name}\n\n` +
        `📱 Iltimos, telefon raqamingizni +998XXXXXXXXX formatida yuboring:`,
        {
          reply_markup: new InlineKeyboard()
            .text('🔙 Orqaga', 'back_to_payment_methods')
            .row()
            .text('🏠 Asosiy menyu', 'main_menu'),
          parse_mode: 'HTML',
        }
      );

      // Telefon raqam kutish
      ctx.session.pendingUserId = userId;
      ctx.session.pendingPlanId = planId;

      // Next message handler uchun flag
      ctx.session.waitingForPhoneNumber = true;

    } catch (error) {
      logger.error('Click invoice yaratishda xatolik:', error);
      await ctx.answerCallbackQuery('Invoice yaratishda xatolik yuz berdi.');
    }
  }

  /**
   * Click invoice yaratish (telefon raqam bilan)
   */
  private async createClickInvoiceWithPhone(phoneNumber: string, userId: string, planId: string, ctx: BotContext): Promise<void> {
    try {
      const user = await UserModel.findById(userId);
      const plan = await Plan.findById(planId);

      if (!user || !plan) {
        await ctx.reply('Foydalanuvchi yoki tarif topilmadi.');
        return;
      }

      // Click invoice yaratish
      const invoiceResponse = await this.clickService.createInvoice(
        plan.price,
        phoneNumber,  // ✅ Foydalanuvchi kiritgan telefon raqam
        userId,       // ✅ User ID
        planId,       // ✅ Plan ID
      );

      if (invoiceResponse.error_code === 0 && invoiceResponse.invoice_id) {
        // Invoice muvaffaqiyatli yaratildi
        const messageText =
          `✅ <b>Click Invoice yaratildi!</b>\n\n` +
          `💰 Summa: ${plan.price.toLocaleString()} so'm\n` +
          `📱 Telefon: ${phoneNumber}\n` +
          `🧾 Invoice ID: ${invoiceResponse.invoice_id}\n\n` +
          `📲 Click ilovasida yoki Click terminalida to'lov qiling.\n` +
          `💡 To'lov qilganingizdan keyin "Status tekshirish" tugmasini bosing.`;

        const keyboard = new InlineKeyboard()
          .text('📋 Status tekshirish', `check_invoice_${invoiceResponse.invoice_id}`)
          .row()
          .text('🔙 Orqaga', 'back_to_payment_methods')
          .row()
          .text('🏠 Asosiy menyu', 'main_menu');

        await ctx.reply(messageText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });

        // Invoice statusini tekshirish uchun session-ga saqlash
        ctx.session.pendingInvoiceId = invoiceResponse.invoice_id;
        ctx.session.pendingUserId = userId;
        ctx.session.pendingPlanId = planId;

      } else {
        await ctx.reply(
          `❌ Invoice yaratishda xatolik: ${invoiceResponse.error_note || 'Noma\'lum xatolik'}`
        );
      }

    } catch (error) {
      logger.error('Click invoice yaratishda xatolik:', error);
      await ctx.reply('❌ Invoice yaratishda xatolik yuz berdi.');
    }
  }

  private async handleInvoiceStatusCheck(ctx: BotContext, invoiceId: number): Promise<void> {
    try {
      const statusResponse = await this.clickService.checkInvoiceStatus(invoiceId);

      let statusText = '';
      let statusEmoji = '';

      switch (statusResponse.invoice_status) {
        case 0:
          statusText = 'Kutilmoqda';
          statusEmoji = '⏳';
          break;
        case 1:
          statusText = 'To\'langan';
          statusEmoji = '✅';
          break;
        case 2:
          statusText = 'Bekor qilingan';
          statusEmoji = '❌';
          break;
        default:
          statusText = 'Noma\'lum';
          statusEmoji = '❓';
      }

      const messageText =
        `📋 <b>Invoice Status</b>\n\n` +
        `🧾 Invoice ID: ${invoiceId}\n` +
        `${statusEmoji} Status: ${statusText}\n` +
        `📝 Izoh: ${statusResponse.error_note || 'Izoh yo\'q'}`;

      const keyboard = new InlineKeyboard();

      if (statusResponse.invoice_status === 1) {
        // To'lov muvaffaqiyatli amalga oshirilgan
        if (ctx.session.pendingUserId && ctx.session.pendingPlanId) {
          const user = await UserModel.findById(ctx.session.pendingUserId);
          if (user) {
            await this.handlePaymentSuccess(
              ctx.session.pendingUserId,
              user.telegramId,
              user.username
            );
          }
        }
        keyboard.text('🎉 To\'lov muvaffaqiyatli!', 'payment_success');
      } else {
        keyboard.text('🔄 Qayta tekshirish', `check_invoice_${invoiceId}`);
      }

      keyboard
        .row()
        .text('🔙 Orqaga', 'back_to_payment_methods')
        .row()
        .text('🏠 Asosiy menyu', 'main_menu');

      await ctx.editMessageText(messageText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });

    } catch (error) {
      logger.error('Invoice status tekshirishda xatolik:', error);
      await ctx.answerCallbackQuery('Status tekshirishda xatolik yuz berdi.');
    }
  }

  /**
   * Text message handler (telefon raqam uchun)
   */
  private async handleTextMessage(ctx: BotContext): Promise<void> {
    // Faqat telefon raqam kutayotgan holatda ishlaydi
    if (!ctx.session.waitingForPhoneNumber) {
      return;
    }

    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    // Telefon raqam validation
    if (this.isValidPhoneNumber(text)) {
      const userId = ctx.session.pendingUserId;
      const planId = ctx.session.pendingPlanId;

      if (userId && planId) {
        // Telefon raqam to'g'ri, invoice yaratamiz
        ctx.session.waitingForPhoneNumber = false;
        await this.createClickInvoiceWithPhone(text, userId, planId, ctx);
      } else {
        await ctx.reply('❌ Sessiya ma\'lumotlari topilmadi. Iltimos, jarayonni qaytadan boshlang.');
      }
    } else {
      await ctx.reply(
        '❌ Noto\'g\'ri telefon raqam formati!\n\n' +
        '📱 Telefon raqamingizni +998XXXXXXXXX formatida kiriting.\n' +
        'Masalan: +998901234567'
      );
    }
  }

  /**
   * Telefon raqam validation
   */
  private isValidPhoneNumber(phone: string): boolean {
    // +998XXXXXXXXX format tekshirish
    const phoneRegex = /^\+998[0-9]{9}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Pending invoice'larni tekshirish va payment status yangilash
   */
  private async checkPendingClickPayments(): Promise<void> {
    try {
      // Oxirgi 1 soat ichida yaratilgan pending invoice'larni topish
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const pendingInvoices = await Transaction.find({
        provider: 'click',
        status: TransactionStatus.PENDING,
        createdAt: { $gte: oneHourAgo },
      }).limit(10); // Bir vaqtda maksimal 10 ta tekshirish

      for (const invoice of pendingInvoices) {
        try {
          // Click API orqali payment status tekshirish
          const merchantTransId = invoice.userId.toString();
          const date = invoice.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD format

          const paymentStatus = await this.clickService.checkPaymentByMerchantTransId(
            merchantTransId,
            date
          );

          if (paymentStatus && paymentStatus.status === 1) {
            // To'lov amalga oshirilgan
            await Transaction.findByIdAndUpdate(invoice._id, {
              status: TransactionStatus.PAID,
            });

            // User topish va botga xabar yuborish
            const user = await UserModel.findById(invoice.userId);
            if (user) {
              await this.handlePaymentSuccess(
                invoice.userId.toString(),
                user.telegramId,
                user.username,
              );
              logger.info(`✅ Pending payment success detected for user: ${user.telegramId}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Error checking pending payment for invoice ${invoice._id}:`, error);
        }
      }
    } catch (error) {
      logger.error('❌ Error in checkPendingClickPayments:', error);
    }
  }

  /**
   * Pending payment'larni tekshirish uchun interval
   */
  private startPaymentStatusChecker(): void {
    // Har 5 daqiqada pending payment'larni tekshirish
    setInterval(() => {
      this.checkPendingClickPayments();
    }, 5 * 60 * 1000); // 5 daqiqa

    logger.info('✅ Click payment status checker started (every 5 minutes)');
  }
}
