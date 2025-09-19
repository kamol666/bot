import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClickController } from "./click.controller";
import { ClickService } from "./click.service";


@Module({
    imports: [ConfigModule],
    controllers: [ClickController],
    providers: [ClickService],
})
export class ClickModule { }