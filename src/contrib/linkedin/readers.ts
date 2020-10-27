/*
 * Copyright (C) 2020 Pixie Brix, LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Reader } from "@/types";
import { withEmberComponentProps } from "@/blocks/readers/emberjs";
import mapValues from "lodash/mapValues";
import { isHost } from "@/extensionPoints/helpers";
import { registerBlock } from "@/blocks/registry";
import fromPairs from "lodash/fromPairs";
import { Schema } from "@/core";

export function getProfileContext(): JQuery | null {
  if (isHost("linkedin.com")) {
    const $profile = $("#profile-content");
    return $profile.length ? $profile : null;
  }
  return undefined;
}

class LinkedInProfileReader extends Reader {
  ROOT_PATH = "parentView";

  PATH_SPEC = {
    firstName: "memberName?.firstName",
    lastName: "memberName?.lastName",
    followersCount: "followersCount",
    vanityName: "vanityName",
    vanityUrl: "model?.vanityUrl",
    headline: "headline",
    isInfluencer: "isInfluencer",
    currentCompanyName: "currentCompanyName",
    geoLocationName: "geoLocationName",
    locationName: "locationName",
    schoolName: "schoolName",
  };

  constructor() {
    super(
      "linkedin/person-summary",
      "LinkedIn Profile Summary",
      "Read summary information from a LinkedIn profile"
    );
  }

  outputSchema: Schema = {
    type: "object",
    properties: fromPairs(
      [...Object.keys(this.PATH_SPEC), "url"].map((x) => [x, {}])
    ),
  };

  async isAvailable() {
    return !!getProfileContext();
  }

  async read() {
    const profile = await withEmberComponentProps({
      selector: ".pv-top-card",
      pathSpec: mapValues(this.PATH_SPEC, (x) => `${this.ROOT_PATH}?.${x}`),
    });
    return {
      ...profile,
      url: window.location.href,
    };
  }
}

export const PROFILER_READER = new LinkedInProfileReader();

registerBlock(PROFILER_READER);
