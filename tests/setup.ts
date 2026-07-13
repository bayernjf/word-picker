import { vi } from "vitest";

const storageState: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      onMessage: {
        addListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      onStartup: {
        addListener: vi.fn(),
      },
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockImplementation(async (keys: string | string[]) => {
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              if (key in storageState) {
                result[key] = storageState[key];
              }
            }
            return result;
          }
          return { [keys]: storageState[keys] };
        }),
        set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
          Object.assign(storageState, items);
        }),
        remove: vi.fn().mockImplementation(async (keys: string | string[]) => {
          if (Array.isArray(keys)) {
            for (const key of keys) {
              delete storageState[key];
            }
          } else {
            delete storageState[keys];
          }
        }),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    alarms: {
      create: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      onAlarm: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

export function resetStorageState(): void {
  Object.keys(storageState).forEach(key => delete storageState[key]);
}
