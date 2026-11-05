import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  DomainValidationError,
  InvalidTransactionStateError,
  ResourceNotFoundError,
  TransientInfrastructureError,
} from "@shared/domain/errors/domain.error";

export interface ErrorResponseBody {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly message: string;
  readonly failureCode?: string;
  readonly timestamp: string;
  readonly path?: string;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: ErrorResponseBody) => void };
    }>();
    const request = ctx.getRequest<{ url?: string }>();

    const body = this.mapExceptionToResponse(exception, request?.url);
    response.status(body.statusCode).json(body);
  }

  mapExceptionToResponse(exception: unknown, path?: string): ErrorResponseBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof BusinessRuleViolationError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        errorCode: exception.errorCode,
        failureCode: exception.failureCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof ConflictError) {
      return {
        statusCode: HttpStatus.CONFLICT,
        errorCode: exception.errorCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof ResourceNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: exception.errorCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof DomainValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: exception.errorCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof TransientInfrastructureError) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: exception.errorCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof InvalidTransactionStateError || exception instanceof DomainError) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: exception.errorCode,
        message: exception.message,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawResponse = exception.getResponse();
      const extractedMessage =
        typeof rawResponse === "object" &&
        rawResponse !== null &&
        "message" in rawResponse
          ? Array.isArray((rawResponse as { message: unknown }).message)
            ? ((rawResponse as { message: string[] }).message.join("; "))
            : String((rawResponse as { message: unknown }).message)
          : exception.message;

      return {
        statusCode: status,
        errorCode: status === HttpStatus.BAD_REQUEST ? "INVALID_PAYLOAD" : "HTTP_ERROR",
        message: extractedMessage,
        timestamp,
        ...(path ? { path } : {}),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "An unexpected internal error occurred",
      timestamp,
      ...(path ? { path } : {}),
    };
  }
}

