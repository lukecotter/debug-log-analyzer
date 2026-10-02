/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { VSWorkspace } from '../VSWorkspace';

export class VSWorkspaceManager {
  workspaceFolders: VSWorkspace[] = [];

  findSymbol = vi.fn();
  getAllProjects = vi.fn();
  initialiseWorkspaceProjectInfo = vi.fn();
  refresh = vi.fn();
}
