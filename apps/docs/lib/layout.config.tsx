import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export const baseOptions: BaseLayoutProps = {
  links: [
    {
      text: 'Docs',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'Components',
      url: '/components',
      active: 'nested-url',
    },
    {
      text: 'Blocks',
      url: '/blocks',
      active: 'nested-url',
    },
  ],
  githubUrl: 'https://github.com/DeDevsClub/design-registry-starter',
  nav: {
    title: (
      <div className="flex items-center gap-2 rounded-md border border-border p-2 hover:bg-muted/60">
        <Image
          alt="Devcn UI Design Registry"
          height={24}
          src="/logo.svg"
          width={24}
        />
        <span className="font-semibold text-lg">Devcn UI Design Registry</span>
      </div>
    ),
  },
};
