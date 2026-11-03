import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = loadEnvironmentConfig();
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(env.port);
}

void bootstrap();

