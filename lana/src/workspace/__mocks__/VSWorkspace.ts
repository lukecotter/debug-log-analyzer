/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { WorkspaceFolder } from 'vscode';
import type { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;
  sfdxProjectsByNamespace: Record<string, SfdxProject[]> = {};

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  path = vi.fn();
  name = vi.fn();
  parseSfdxProjects = vi.fn();
  getProjectsForNamespace = vi.fn();
  getAllProjects = vi.fn();
  findClass = vi.fn();
}
