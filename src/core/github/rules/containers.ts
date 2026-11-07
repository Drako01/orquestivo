import { asMap, asString } from '../context.js';
import type { Rule, RuleContext, Path } from '../context.js';
import { DOCS } from '../docs.js';
import { meta } from '../rule.js';

const CONTAINER_MUTABLE_TAG = meta('CONTAINER_MUTABLE_TAG', 'warning', 'security',
  'Mutable image tags can change between runs, breaking reproducibility and trust.',
  'Pin the image to a digest (image@sha256:...).', DOCS.jobContainers);
const CONTAINER_INVALID = meta('CONTAINER_INVALID', 'error', 'semantic',
  'A job container needs an image; GitHub rejects it otherwise.', 'Set container: <image> or container.image.', DOCS.jobContainers);
const SERVICES_INVALID = meta('SERVICES_INVALID', 'error', 'semantic',
  'services must be a mapping of name to a definition with an image; ports, when present, must be a list.',
  'Define services.<name>.image and optional ports as a list.', DOCS.serviceContainers);

/** Image reference of a container definition given as a string or `{ image }` mapping. */
const imageOf = (value: unknown): string | undefined => asString(value) ?? asString(asMap(value)?.image);

function checkImage(ctx: RuleContext, image: string, label: string, path: Path): void {
  if (!image.includes('@sha256:')) {
    ctx.report(CONTAINER_MUTABLE_TAG, label + ' is not digest-pinned.', path, { snippet: image });
  }
}

export const containersRule: Rule = {
  id: 'containers',
  metas: [CONTAINER_MUTABLE_TAG, CONTAINER_INVALID, SERVICES_INVALID],
  check(ctx) {
    for (const { id, job, path } of ctx.jobs) {
      if (job.container !== undefined) {
        const image = imageOf(job.container);
        if (image === undefined || image.trim() === '') {
          ctx.report(CONTAINER_INVALID, 'Job "' + id + '" container needs an image.', [...path, 'container']);
        } else checkImage(ctx, image, 'Job "' + id + '" container', [...path, 'container']);
      }
      if (job.services === undefined) continue;
      const services = asMap(job.services);
      if (!services) {
        ctx.report(SERVICES_INVALID, 'Job "' + id + '" services must be a mapping.', [...path, 'services']);
        continue;
      }
      for (const [name, value] of Object.entries(services)) {
        const where = [...path, 'services', name];
        const image = imageOf(value);
        const ports = asMap(value)?.ports;
        if (image === undefined || image.trim() === '') {
          ctx.report(SERVICES_INVALID, 'Service "' + name + '" of "' + id + '" needs an image.', where);
        } else if (ports !== undefined && !Array.isArray(ports)) {
          ctx.report(SERVICES_INVALID, 'Service "' + name + '" ports must be a list.', [...where, 'ports']);
        } else checkImage(ctx, image, 'Service "' + name + '" of "' + id + '"', where);
      }
    }
  },
};
