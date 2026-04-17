export interface DateRange {
  earliest: string; // YYYY-MM-DD
  latest: string;   // YYYY-MM-DD
}

export interface TimeRange {
  earliestHour: number; // 0-23
  latestHour: number;   // 0-23
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  chatIds?: string[]; // extra targets (e.g. groups); chatId is always included
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  to: string;
}

export interface NotificationConfig {
  telegram?: TelegramConfig;
  email?: EmailConfig;
  desktop: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  targetCountries: string[];
  preferredCities: string[];
  visaCategory: string;
  dateRange: DateRange;
  timeRange: TimeRange;
  pollingIntervalSeconds: number;
  maxConsecutiveErrors: number;
}

export interface AppConfig {
  providers: ProviderConfig[];
  notifications: NotificationConfig;
}
