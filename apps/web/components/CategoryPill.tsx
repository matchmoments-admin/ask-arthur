import Link from "next/link";

interface CategoryPillProps {
  name: string;
  href?: string;
}

export default function CategoryPill({ name, href }: CategoryPillProps) {
  const classes =
    "inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-teal-50 text-action-teal border border-teal-200";

  if (href) {
    return (
      <Link href={href} className={`${classes} hover:bg-teal-100 transition-colors`}>
        {name}
      </Link>
    );
  }

  return <span className={classes}>{name}</span>;
}
