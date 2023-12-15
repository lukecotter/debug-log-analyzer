/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

export class GetLogFile {
  static async apply(wsPath: string, logDir: string, logId: string): Promise<void> {
    const { AuthHelper } = await import('@apexdevtools/sfdx-auth-helper');
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    if (connection) {
      const { LogService } = await import('@salesforce/apex-node');
      await new LogService(connection).getLogs({ logId: logId, outputDir: logDir });
    }
    return new Promise((resolve) => resolve());
  }
}
