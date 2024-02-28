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

import {
  tokenAuthDataFactory,
  meApiResponseFactory,
} from "@/testUtils/factories/authFactories";
import { appApiMock } from "@/testUtils/appApiMock";
import { TEST_setAuthData } from "@/auth/authStorage";
import type { components } from "@/types/swagger";
import { getLinkedApiClient } from "@/data/service/apiClient";

// In existing code, there was a lot of places mocking both useQueryState and useGetMeQuery. This could in some places
// yield impossible states due to how `skip` logic in calls like RequireAuth, etc.

export async function mockAnonymousUser(): Promise<void> {
  // We need to restore the real implementation here to test linked/unlinked extension behavior
  //  See: src/__mocks__/@/data/service/apiClient.js
  jest.mocked(getLinkedApiClient).mockImplementation(getLinkedApiClient);
  appApiMock.onGet("/api/me/").reply(200, {
    // Anonymous users still get feature flags
    flags: [],
  });
  // eslint-disable-next-line new-cap
  await TEST_setAuthData({});
}

export async function mockAuthenticatedUserApiResponse(
  me?: components["schemas"]["Me"],
): Promise<void> {
  const user = me ?? meApiResponseFactory();
  appApiMock.onGet("/api/me/").reply(200, user);
  const tokenData = tokenAuthDataFactory({
    email: user.email,
    user: user.id,
  });
  // eslint-disable-next-line new-cap
  await TEST_setAuthData(tokenData);
}

export function mockErrorUser(error: unknown): void {
  appApiMock.onGet("/api/me/").reply(500, error);
}
