import { isHttpLink } from "@/lib/job-application";

// A job candidate's link on /admin/careers/[id] (#376): clickable ONLY when it
// is an http(s) link — the server stored nothing else
// (lib/job-application.ts:isHttpLink), and this check holds even for a row
// written some other way. New tab, no opener, no referrer, and `nofollow
// ugc`: it is a stranger's URL. Anything else — an @handle — is plain text.
export function CandidateLink({ value }: { value: string }) {
  return isHttpLink(value) ? (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="break-all font-mono text-xs text-gold underline underline-offset-2"
    >
      {value}
    </a>
  ) : (
    <span className="break-all font-mono text-xs">{value}</span>
  );
}
