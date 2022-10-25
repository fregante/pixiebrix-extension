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

import PipelineExpressionVisitor from "@/blocks/PipelineExpressionVisitor";
import { VisitBlockExtra, VisitPipelineExtra } from "@/blocks/PipelineVisitor";
import { BlockPosition, BlockConfig } from "@/blocks/types";
import { BlockArgContext, Expression } from "@/core";
import { ADAPTERS } from "@/pageEditor/extensionPoints/adapter";
import { FormState } from "@/pageEditor/extensionPoints/formStateTypes";
import { getInputKeyForSubPipeline } from "@/pageEditor/utils";
import { isVarExpression } from "@/runtime/mapArgs";
import { makeServiceContext } from "@/services/serviceUtils";
import { isEmpty, pick } from "lodash";
import extensionPointRegistry from "@/extensionPoints/registry";
import { makeInternalId } from "@/registry/internal";
import { Analysis, Annotation, AnnotationType } from "@/analysis/analysisTypes";

export enum VarExistence {
  MAYBE = "MAYBE",
  DEFINITELY = "DEFINITELY",
}

type BlockVars = Map<string, VarExistence>;
type ExtensionVars = Map<string, BlockVars>;
type PreviousVisitedBlock = {
  vars: BlockVars;
  output: BlockVars | null;
};
class VarAnalysis extends PipelineExpressionVisitor implements Analysis {
  private readonly knownVars: ExtensionVars = new Map<string, BlockVars>();
  private previousVisitedBlock: PreviousVisitedBlock = null;
  private readonly contextStack: PreviousVisitedBlock[] = [];
  protected readonly annotations: Annotation[] = [];

  get id() {
    return "var";
  }

  getAnnotations(): Annotation[] {
    return this.annotations;
  }

  getKnownVars() {
    return this.knownVars;
  }

  override visitBlock(
    position: BlockPosition,
    blockConfig: BlockConfig,
    extra: VisitBlockExtra
  ) {
    const currentBlockVars = new Map<string, VarExistence>([
      ...this.previousVisitedBlock.vars,
      ...(this.previousVisitedBlock.output ?? []),
    ]);
    this.knownVars.set(position.path, currentBlockVars);

    const currentBlockOutput = new Map<string, VarExistence>();

    if (blockConfig.outputKey) {
      currentBlockOutput.set(
        `@${blockConfig.outputKey}`,
        blockConfig.if == null ? VarExistence.DEFINITELY : VarExistence.MAYBE
      );

      // TODO: revisit the wildcard/regex format of MAYBE vars
      currentBlockOutput.set(`@${blockConfig.outputKey}.*`, VarExistence.MAYBE);
    }

    this.previousVisitedBlock = {
      vars: currentBlockVars,
      output: currentBlockOutput,
    };

    super.visitBlock(position, blockConfig, extra);
  }

  override visitExpression(
    position: BlockPosition,
    expression: Expression<unknown>,
    blockPosition: BlockPosition
  ): void {
    if (!isVarExpression(expression)) {
      return;
    }

    const varName = expression.__value__;
    const blockKnownVars = this.knownVars.get(blockPosition.path);
    if (blockKnownVars?.get(varName) == null) {
      // TODO refactor the following check, it's very inefficient
      const wildcardVars = [...blockKnownVars.keys()].filter((x) =>
        x.endsWith(".*")
      );
      const matchWildcard = wildcardVars.some((x) =>
        varName.startsWith(x.slice(0, -1))
      );
      if (!matchWildcard) {
        this.annotations.push({
          position,
          message: `Variable ${varName} might not be defined`,
          analysisId: this.id,
          type: AnnotationType.Warning,
          detail: {
            expression,
            knownVars: blockKnownVars?.keys(),
          },
        });
      }
    }
  }

  override visitPipeline(
    position: BlockPosition,
    pipeline: BlockConfig[],
    extra: VisitPipelineExtra
  ) {
    // Getting element key for sub pipeline if applicable (e.g. for a for-each block)
    const subPipelineInput =
      extra.parentNode && extra.pipelinePropName
        ? getInputKeyForSubPipeline(extra.parentNode, extra.pipelinePropName)
        : null;

    // Before visiting the sub pipeline, we need to save the current context
    this.contextStack.push(this.previousVisitedBlock);

    // Creating context for the sub pipeline
    this.previousVisitedBlock = {
      vars: this.previousVisitedBlock.vars,
      output: subPipelineInput
        ? new Map([[`@${subPipelineInput}`, VarExistence.DEFINITELY]])
        : null,
    };

    super.visitPipeline(position, pipeline, extra);

    // Restoring the context of the parent pipeline
    this.previousVisitedBlock = this.contextStack.pop();
  }

  async run(extension: FormState): Promise<void> {
    let context = {} as BlockArgContext;

    const serviceContext = extension.services?.length
      ? await makeServiceContext(extension.services)
      : null;
    if (serviceContext) {
      context = {
        ...context,
        ...serviceContext,
      };
    }

    // Getting the extensions @input vars
    const { selectExtensionPoint } = ADAPTERS.get(extension.type);
    const extensionPointConfig = selectExtensionPoint(extension);
    const obj = pick(extensionPointConfig, ["kind", "definition"]);
    const registryId = makeInternalId(obj);
    const extensionPoint = await extensionPointRegistry.lookup(registryId);
    const reader = await extensionPoint?.defaultReader();
    const readerProperties = reader?.outputSchema?.properties || {};
    const readerKeys = Object.keys(readerProperties);
    if (readerKeys.length > 0) {
      context["@input"] = {};
      for (const key of readerKeys) {
        context["@input"][key] = "";
      }
    }

    // TODO: should we check the blueprint definition instead?
    if (!isEmpty(extension.optionsArgs)) {
      context["@options"] = extension.optionsArgs;
    }

    const definitelyVars = getVarsFromObject(context);
    this.previousVisitedBlock = {
      vars: new Map<string, VarExistence>(
        definitelyVars.map((x) => [x, VarExistence.DEFINITELY])
      ),
      output: null,
    };

    this.visitRootPipeline(extension.extension.blockPipeline, {
      extensionPointType: extension.type,
    });
  }
}

export function getVarsFromObject(obj: unknown): string[] {
  const vars: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    vars.push(key);
    if (typeof value === "object") {
      const nestedVars = getVarsFromObject(value);
      vars.push(...nestedVars.map((x) => `${key}.${x}`));
    }
  }

  return vars;
}

export default VarAnalysis;
