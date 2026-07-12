export {
  anonymousAuthorizationContext,
  AuthorizationError,
  requireAdministrator,
  requireOwnedResource,
  requireVerifiedPlayer,
  type AuthorizationContext,
} from "./authorization.js";
import type { AuthorizationContext } from "./authorization.js";

export type CommandContext = Readonly<{
  requestId: string;
  commandId: string;
  transactionId: string;
  idempotencyKey: string;
  authorization: AuthorizationContext;
}>;

export type QueryContext = Readonly<{
  requestId: string;
  authorization: AuthorizationContext;
}>;

export interface CommandHandler<TCommand, TResult> {
  execute(command: TCommand, context: CommandContext): Promise<TResult>;
}

export interface QueryHandler<TQuery, TResult> {
  execute(query: TQuery, context: QueryContext): Promise<TResult>;
}

export type SampleCommand = Readonly<{ message: string }>;

export type SampleCommandResult = Readonly<{
  message: string;
  commandId: string;
  transactionId: string;
  executedAt: string;
}>;

export type Clock = Readonly<{ now: () => Date }>;

export type ApplicationServices = Readonly<{
  sampleCommand: CommandHandler<SampleCommand, SampleCommandResult>;
}>;

export function createApplicationServices(
  clock: Clock = { now: () => new Date() },
): ApplicationServices {
  return {
    sampleCommand: {
      async execute(command, context) {
        return {
          message: command.message,
          commandId: context.commandId,
          transactionId: context.transactionId,
          executedAt: clock.now().toISOString(),
        };
      },
    },
  };
}

export { GetPublishedCatalogHandler, type GetPublishedCatalog } from "./catalog.js";
export { FinancePostingService } from "./finance.js";
export { AirlineFoundingService } from "./airline.js";
export { DueAircraftDeliveryHandler, FleetService } from "./fleet.js";
export { FuelConsumptionService, FuelService } from "./fuel.js";
export { MarketService } from "./market.js";
export { SchedulingService } from "./scheduling.js";
export { WorkforceService } from "./workforce.js";
export { MaintenanceService } from "./maintenance.js";
