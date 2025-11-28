declare module "validator" {
  export interface IsEmailOptions {
    allow_display_name?: boolean | undefined;
    allow_utf8_local_part?: boolean | undefined;
    require_tld?: boolean | undefined;
    require_display_name?: boolean | undefined;
    allow_ip_domain?: boolean | undefined;
    domain_specific_validation?: boolean | undefined;
    blacklisted_chars?: string | undefined;
    host_whitelist?: string[] | undefined;
    host_blacklist?: string[] | undefined;
    ignore_max_length?: boolean | undefined;
  }

  export interface NormalizeEmailOptions {
    all_lowercase?: boolean | undefined;
    gmail_lowercase?: boolean | undefined;
    gmail_remove_dots?: boolean | undefined;
    gmail_remove_subaddress?: boolean | undefined;
    gmail_convert_googlemaildotcom?: boolean | undefined;
    outlookdotcom_lowercase?: boolean | undefined;
    outlookdotcom_remove_subaddress?: boolean | undefined;
    yahoo_lowercase?: boolean | undefined;
    yahoo_remove_subaddress?: boolean | undefined;
    icloud_lowercase?: boolean | undefined;
    icloud_remove_subaddress?: boolean | undefined;
    remove_subaddress?: boolean | undefined;
  }

  export function isEmail(str: string, options?: IsEmailOptions): boolean;

  export function normalizeEmail(str: string, options?: NormalizeEmailOptions): string | false;

  const validator: {
    isEmail: typeof isEmail;
    normalizeEmail: typeof normalizeEmail;
  };

  export default validator;
}

