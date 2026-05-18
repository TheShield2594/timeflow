// Power Apps Code Apps runtime — exposed as window.PowerApps inside the host.
// The connector wrapper API matches the shape documented in the project README
// (OData-style options on listRecords; @odata.bind for lookup writes).
// If a newer SDK version exposes a different shape, adapt the mappers in
// services/dataverseService.ts — the rest of the app does not depend on this.

export interface PowerAppsListOptions {
  $filter?: string;
  $orderby?: string;
  $top?: number;
  $select?: string;
  $expand?: string;
}

export interface PowerAppsListResult<T = Record<string, unknown>> {
  value: T[];
  "@odata.nextLink"?: string;
}

export interface PowerAppsDataverseConnector {
  listRecords<T = Record<string, unknown>>(
    table: string,
    opts?: PowerAppsListOptions
  ): Promise<PowerAppsListResult<T>>;
  createRecord<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown>
  ): Promise<T>;
  updateRecord<T = Record<string, unknown>>(
    table: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<T>;
  deleteRecord(table: string, id: string): Promise<void>;
}

export interface PowerAppsOffice365UsersConnector {
  MyProfile(): Promise<{
    Id?: string;
    DisplayName?: string;
    Mail?: string;
    UserPrincipalName?: string;
    [key: string]: unknown;
  }>;
}

export interface PowerAppsUserInfo {
  userId: string;
  email?: string;
  displayName: string;
}

export interface PowerAppsRuntime {
  Connectors: {
    MicrosoftDataverse: PowerAppsDataverseConnector;
    Office365Users?: PowerAppsOffice365UsersConnector;
  };
  userInfo?: PowerAppsUserInfo;
}

declare global {
  interface Window {
    PowerApps?: PowerAppsRuntime;
  }
}

export {};
