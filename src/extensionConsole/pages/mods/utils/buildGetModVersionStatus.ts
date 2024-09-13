/*
 * Copyright (C) 2024 PixieBrix, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { type ActivatedModComponent } from "@/types/modComponentTypes";
import { type Mod, type ModVersionStatus } from "@/types/modTypes";
import { assertNotNullish, type Nullishable } from "@/utils/nullishUtils";
import { isUnavailableMod } from "@/utils/modUtils";
import * as semver from "semver";
import { type SemVerString } from "@/types/registryTypes";
import { type Timestamp } from "@/types/stringTypes";

type ModVersionInfo = {
  version: SemVerString;
  updatedAt: Timestamp;
};

function isLatestVersion(
  activated: Nullishable<ModVersionInfo>,
  current: Nullishable<ModVersionInfo>,
): boolean {
  if (current == null || activated == null) {
    return true; // No update available if either version is null
  }

  if (semver.gt(current.version, activated.version)) {
    return false;
  }

  if (semver.lt(current.version, activated.version)) {
    return true;
  }

  // Versions are equal, compare updated_at timestamp
  return new Date(current.updatedAt) <= new Date(activated.updatedAt);
}

function getModVersionInfo(mod: Mod): ModVersionInfo | null {
  if (isUnavailableMod(mod)) {
    return null;
  }

  assertNotNullish(
    mod.metadata.version,
    `Mod version is null for mod: ${mod.metadata.id}, something went wrong`,
  );

  return {
    version: mod.metadata.version,
    updatedAt: mod.updated_at,
  };
}

function getActivatedModVersionInfo(
  activatedModComponent: ActivatedModComponent | undefined,
): ModVersionInfo | null {
  if (activatedModComponent == null) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- We've migrated _recipe to be non-null everywhere but the type isn't updated yet
  const modMetadata = activatedModComponent._recipe!;
  const { version: activatedModVersion, updated_at: activatedModUpdatedAt } =
    modMetadata;

  assertNotNullish(
    activatedModVersion,
    `Activated mod version is null for mod: ${modMetadata.id}, something went wrong`,
  );
  assertNotNullish(
    activatedModUpdatedAt,
    `Activated mod updated_at is null for mod: ${modMetadata.id}, something went wrong`,
  );

  return {
    version: activatedModVersion,
    updatedAt: activatedModUpdatedAt,
  };
}

export default function buildGetModVersionStatus(
  activatedModComponents: ActivatedModComponent[],
): (mod: Mod) => ModVersionStatus {
  return (mod: Mod) => {
    const activatedModComponent = activatedModComponents.find(
      ({ _recipe }) => _recipe?.id === mod.metadata.id,
    );

    const currentVersionInfo = getModVersionInfo(mod);
    const activatedVersionInfo = getActivatedModVersionInfo(
      activatedModComponent,
    );

    return {
      hasUpdate: !isLatestVersion(activatedVersionInfo, currentVersionInfo),
      activatedModVersion: activatedVersionInfo?.version ?? null,
    };
  };
}
