import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import morgan from "morgan";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

export async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    const configService: ConfigService = app.get(ConfigService);

    app.useStaticAssets(join(process.cwd(), 'public'));
    app.setViewEngine('ejs');
    app.setBaseViewsDir(join(process.cwd(), 'view'));



    app.enableCors({
        origin: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
    });

    app.setGlobalPrefix('api');

    app.use(morgan('dev'));

    const PORT = configService.get<string>('APP_PORT') || 3000;
    await app.listen(PORT);
    console.log(`Application is running on: ${await app.getUrl()}`);
}