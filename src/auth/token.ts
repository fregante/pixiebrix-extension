/*
 * Copyright (C) 2022 PixieBrix, Inc.
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

import Cookies from "js-cookie";
import { ManualStorageKey, readStorage, setStorage } from "@/chrome";
import {
  PartnerAuthData,
  TokenAuthData,
  USER_DATA_UPDATE_KEYS,
  UserData,
  UserDataUpdate,
} from "./authTypes";
import { isExtensionContext } from "webext-detect-page";
import { expectContext } from "@/utils/expectContext";
import { isEmpty, omit, remove } from "lodash";
import { UnknownObject } from "@/types";

const STORAGE_EXTENSION_KEY = "extensionKey" as ManualStorageKey;
const STORAGE_PARTNER_TOKEN = "partnerToken" as ManualStorageKey;

type AuthListener = (auth: Partial<TokenAuthData>) => void;

const listeners: AuthListener[] = [];

// Use listeners to allow inversion of control and avoid circular dependency with rollbar.
export function addListener(handler: AuthListener): void {
  listeners.push(handler);
}

export function removeListener(handler: AuthListener): void {
  remove(listeners, (x) => x === handler);
}

export async function readAuthData(): Promise<
  TokenAuthData | Partial<TokenAuthData>
> {
  return readStorage(STORAGE_EXTENSION_KEY, {});
}

export async function readPartnerAuthData(): Promise<
  PartnerAuthData | Partial<PartnerAuthData>
> {
  return readStorage(STORAGE_PARTNER_TOKEN, {});
}

export async function flagOn(flag: string): Promise<boolean> {
  const authData = await readAuthData();
  return authData.flags?.includes(flag);
}

/**
 * Return the PixieBrix API token (issued by the PixieBrix API).
 */
export async function getExtensionToken(): Promise<string | undefined> {
  const { token } = await readAuthData();
  return token;
}

/**
 * Get the partner JWT token for authentication, or null/undefined if not set.
 */
export async function getPartnerToken(): Promise<string | undefined> {
  const { token } = await readPartnerAuthData();
  return token;
}

/**
 * Set authentication data when using the partner JWT to authenticate.
 */
export async function setPartnerAuth(data: PartnerAuthData): Promise<void> {
  if (!isEmpty(data.authId) && isEmpty(data.token)) {
    throw new Error("Received null/blank token for partner integration");
  }

  return setStorage(STORAGE_PARTNER_TOKEN, data);
}

/**
 * Return PixieBrix API authentication headers, or null if not authenticated.
 */
export async function getAuthHeaders(): Promise<UnknownObject | null> {
  const [token, partnerToken] = await Promise.all([
    getExtensionToken(),
    getPartnerToken(),
  ]);

  if (token) {
    return {
      Authorization: `Token ${token}`,
    };
  }

  if (partnerToken) {
    return {
      Authorization: `Bearer ${partnerToken}`,
    };
  }

  return null;
}

/**
 * Return `true` if the extension is linked to the API.
 *
 * NOTE: do not use this as a check before making an authenticated API call. Instead, use `maybeGetLinkedApiClient`
 * which avoids a race condition between the time the check is made and underlying `getExtensionToken` call to get
 * the token.
 *
 * @see maybeGetLinkedApiClient
 */
export async function isLinked(): Promise<boolean> {
  return (await getAuthHeaders()) != null;
}

/**
 * Return non-sensitive user profile data.
 * @see getExtensionAuth
 */
export async function getUserData(): Promise<Partial<UserData>> {
  expectContext("extension");
  const data = await readAuthData();
  return omit(data, "token");
}

/**
 * Return information about the principal and tenant
 */
export async function getExtensionAuth(): Promise<
  Pick<UserData, "user" | "email" | "hostname">
> {
  expectContext("extension");
  const { user, email, hostname } = await readAuthData();
  return { user, email, hostname };
}

/**
 * Clear the extension state. The options page will show as "unlinked" and prompt the user to link their account.
 */
export async function clearExtensionAuth(): Promise<void> {
  console.debug("Clearing extension auth");
  await browser.storage.local.remove(STORAGE_EXTENSION_KEY);
  await browser.storage.local.remove(STORAGE_PARTNER_TOKEN);
  Cookies.remove("csrftoken");
  Cookies.remove("sessionid");
}

/**
 * Update user data (for use in Rollbar, etc.), but not the auth token
 *
 * This method is currently used to ensure the most up-to-date organization and flags for the user. It's called in:
 * - The background heartbeat
 * - The getAuth query made by extension pages
 *
 * @see linkExtension
 */
export async function updateUserData(update: UserDataUpdate): Promise<void> {
  const updated = await readAuthData();

  for (const key of USER_DATA_UPDATE_KEYS) {
    // Intentionally overwrite values with null/undefined from the update
    // eslint-disable-next-line security/detect-object-injection,@typescript-eslint/no-explicit-any -- keys from compile-time constant
    updated[key] = update[key] as any;
  }

  await setStorage(STORAGE_EXTENSION_KEY, updated);
}

/**
 * Link the browser extension to the user's PixieBrix account. Return true if the link was updated
 *
 * This method is called (via messenger) when the user visits the app.
 *
 * @see updateUserData
 */
export async function linkExtension(auth: TokenAuthData): Promise<boolean> {
  if (!auth) {
    return false;
  }

  const previous = await readAuthData();

  // Previously we used to check all the data, but that was problematic because it made evolving the data fields tricky.
  // The server would need to change which data it sent based on the version of the extension. There's an interplay
  // between updateUserData and USER_DATA_UPDATE_KEYS and the data set with updateExtensionAuth
  const updated =
    auth.user !== previous.user || auth.hostname !== previous.hostname;

  console.debug(`Setting extension auth for ${auth.email}`, auth);
  await setStorage(STORAGE_EXTENSION_KEY, auth);
  return updated;
}

if (isExtensionContext()) {
  browser.storage.onChanged.addListener((changes, storage) => {
    if (storage === "local") {
      // eslint-disable-next-line security/detect-object-injection -- compile time constant
      const change =
        changes[STORAGE_EXTENSION_KEY] ?? changes[STORAGE_PARTNER_TOKEN];

      if (change) {
        for (const listener of listeners) {
          listener(change.newValue);
        }
      }
    }
  });
}
