import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import logger from './shared/utils/logger';
import * as process from 'node:process';
import { connectDB } from './shared/database/db';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Get the config service to access environment variables properly
  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 8988);

  app.setGlobalPrefix('api');

  await connectDB();

  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setViewEngine('ejs');
  app.setBaseViewsDir(join(process.cwd(), 'view'));

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  logger.info(`Starting application on port: ${port}`);

  try {
    await app.listen(port, '0.0.0.0'); // Explicitly bind to all interfaces
    const appUrl = await app.getUrl();
    logger.info(`✅ Application successfully started on: ${appUrl}`);
    console.log(`✅ Application successfully started on: ${appUrl}`);

    // Verify the port is actually listening
    console.log(
      `🔍 Server should be accessible at: http://localhost:${port}/api`,
    );
  } catch (error) {
    logger.error(`❌ Failed to start application on port ${port}:`, error);
    throw error;
  }
}

bootstrap().catch((error) => {
  logger.error('Fatal error during bootstrap', error);
  process.exit(1);
});
