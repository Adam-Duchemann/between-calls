import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getAppWithMetadata } from "@calcom/app-store/_appRegistry";
import { getAppAssetFullPath } from "@calcom/app-store/getAppAssetFullPath";
import { IS_PRODUCTION } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import yaml from "js-yaml";
import { z } from "zod";

const log = logger.getSubLogger({ prefix: ["lib", "parseFrontmatter"] });

const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const UPSTREAM_NAME = /\bcal\.(?:com|diy)\b/i;
const UPSTREAM_EMAIL = /@(?:[^@]+\.)*cal\.(?:com|diy)$/i;
const UPSTREAM_LINK =
  /^(?:https?:\/\/)?(?:(?:[^/.:]+\.)*cal\.(?:com|diy)(?:[/:?#]|$)|github\.com\/calcom\/cal\.diy(?:[/?#]|$))/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parses markdown content with YAML frontmatter
 * Replaces gray-matter to use js-yaml 4.x directly (yaml.load is safe by default)
 */
export function parseFrontmatter(source: string): { data: Record<string, unknown>; content: string } {
  const match = source.match(FRONTMATTER_REGEX);

  if (!match) {
    return { data: {}, content: source };
  }

  let data: Record<string, unknown> = {};

  try {
    const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });

    if (isRecord(parsed)) {
      data = parsed;
    }
  } catch (error) {
    log.warn("Invalid YAML frontmatter", { error });
  }

  return {
    data,
    content: source.slice(match[0].length),
  };
}

export const sourceSchema = z.object({
  content: z.string(),
  data: z.object({
    description: z.string().optional(),
    items: z
      .array(
        z.union([
          z.string(),
          z.object({
            iframe: z.object({ src: z.string() }),
          }),
        ])
      )
      .optional(),
  }),
});

export type AppDataProps = NonNullable<Awaited<ReturnType<typeof getStaticProps>>>;

export const getStaticProps = async (slug: string) => {
  const appMeta = await getAppWithMetadata({
    slug,
  });

  const appFromDb = await prisma.app.findUnique({
    where: { slug: slug.toLowerCase() },
  });

  const isAppAvailableInFileSystem = appMeta;
  const isAppDisabled = isAppAvailableInFileSystem && (!appFromDb || !appFromDb.enabled);

  if (!IS_PRODUCTION && isAppDisabled) {
    return {
      isAppDisabled: true as const,
      data: {
        ...appMeta,
      },
    };
  }

  if (!appFromDb || !appMeta || isAppDisabled) return null;

  const isTemplate = appMeta.isTemplate;
  const appDirname = path.join(isTemplate ? "templates" : "", appFromDb.dirName);
  const README_PATH = path.join(process.cwd(), "..", "..", `packages/app-store/${appDirname}/DESCRIPTION.md`);
  const postFilePath = path.join(README_PATH);
  let source = "";

  try {
    source = fs.readFileSync(postFilePath).toString();
    source = source.replace(/{DESCRIPTION}/g, appMeta.description);
  } catch (error) {
    /* If the app doesn't have a README we fallback to the package description */
    console.log(`No DESCRIPTION.md provided for: ${appDirname}`);
    source = appMeta.description;
  }

  const result = parseFrontmatter(source);
  const { content, data } = sourceSchema.parse({ content: result.content, data: result.data });
  if (process.env.CAL_PRIVATE_INSTANCE === "true") {
    return {
      isAppDisabled: false as const,
      privateInstance: true,
      installUrl: appMeta.url,
      source: {
        content: UPSTREAM_NAME.test(content) ? appMeta.description : content,
        data: { items: undefined },
      },
      data: {
        ...appMeta,
        publisher: UPSTREAM_NAME.test(appMeta.publisher) ? "" : appMeta.publisher,
        url: UPSTREAM_LINK.test(appMeta.url) ? "" : appMeta.url,
        email: UPSTREAM_EMAIL.test(appMeta.email) ? "" : appMeta.email,
        docsUrl: appMeta.docsUrl && !UPSTREAM_LINK.test(appMeta.docsUrl) ? appMeta.docsUrl : undefined,
      },
    };
  }
  if (data.items) {
    data.items = data.items.map((item) => {
      if (typeof item === "string") {
        return getAppAssetFullPath(item, {
          dirName: appMeta.dirName,
          isTemplate: appMeta.isTemplate,
        });
      }
      return item;
    });
  }
  return {
    isAppDisabled: false as const,
    privateInstance: false,
    installUrl: appMeta.url,
    source: { content, data },
    data: appMeta,
  };
};
