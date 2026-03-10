#!/usr/bin/env python3
"""
Interactive CLI to add a new user to sample.keycloak.yaml.

Prompts for all required fields, validates input, applies defaults,
and appends the formatted YAML user block to the file.
"""

import re
import sys
import textwrap

# ---------------------------------------------------------------------------
# Valid value sets
# ---------------------------------------------------------------------------

VALID_CLEARANCES = {
    "TS": "Top Secret",
    "S": "Secret",
    "C": "Confidential",
    "U": "Unclassified",
}

VALID_NEED_TO_KNOW = ["AAA", "BBB", "INT", "OPS"]

VALID_REALM_ROLES = ["opentdf-org-admin", "opentdf-admin", "opentdf-standard"]

# ISO 3166-1 alpha-3 — a broad set; extend as needed.
ISO3166_ALPHA3 = {
    "AFG","ALB","DZA","AND","AGO","ATG","ARG","ARM","AUS","AUT","AZE",
    "BHS","BHR","BGD","BRB","BLR","BEL","BLZ","BEN","BTN","BOL","BIH",
    "BWA","BRA","BRN","BGR","BFA","BDI","CPV","KHM","CMR","CAN","CAF",
    "TCD","CHL","CHN","COL","COM","COD","COG","CRI","HRV","CUB","CYP",
    "CZE","DNK","DJI","DOM","ECU","EGY","SLV","GNQ","ERI","EST","SWZ",
    "ETH","FJI","FIN","FRA","GAB","GMB","GEO","DEU","GHA","GRC","GRD",
    "GTM","GIN","GNB","GUY","HTI","HND","HUN","ISL","IND","IDN","IRN",
    "IRQ","IRL","ISR","ITA","JAM","JPN","JOR","KAZ","KEN","KIR","PRK",
    "KOR","KWT","KGZ","LAO","LVA","LBN","LSO","LBR","LBY","LIE","LTU",
    "LUX","MDG","MWI","MYS","MDV","MLI","MLT","MHL","MRT","MUS","MEX",
    "FSM","MDA","MCO","MNG","MNE","MAR","MOZ","MMR","NAM","NRU","NPL",
    "NLD","NZL","NIC","NER","NGA","MKD","NOR","OMN","PAK","PLW","PAN",
    "PNG","PRY","PER","PHL","POL","PRT","QAT","ROU","RUS","RWA","KNA",
    "LCA","VCT","WSM","SMR","STP","SAU","SEN","SRB","SYC","SLE","SGP",
    "SVK","SVN","SLB","SOM","ZAF","SSD","ESP","LKA","SDN","SUR","SWE",
    "CHE","SYR","TWN","TJK","TZA","THA","TLS","TGO","TON","TTO","TUN",
    "TUR","TKM","TUV","UGA","UKR","ARE","GBR","USA","URY","UZB","VUT",
    "VEN","VNM","YEM","ZMB","ZWE",
}

KEYCLOAK_YAML = "sample.keycloak.yaml"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def prompt(label: str, default: str | None = None, required: bool = True) -> str:
    """Prompt the user for a value, showing the default if one exists."""
    if default is not None:
        display = f"{label} [default: {default}]: "
    else:
        display = f"{label}: "

    while True:
        value = input(display).strip()
        if not value:
            if default is not None:
                print(f"  -> Using default: {default}")
                return default
            if required:
                print(f"  ERROR: {label} is required.")
            else:
                return ""
        else:
            return value


def prompt_choice(label: str, choices: list[str], default: str | None = None) -> str:
    """Prompt the user to pick one value from a fixed list."""
    choices_str = " | ".join(choices)
    if default:
        display = f"{label} ({choices_str}) [default: {default}]: "
    else:
        display = f"{label} ({choices_str}): "

    while True:
        value = input(display).strip().upper() if label != "Realm role" else input(display).strip()
        if not value:
            if default is not None:
                print(f"  -> Using default: {default}")
                return default
            print(f"  ERROR: Please choose one of: {choices_str}")
            continue
        # Case-insensitive match for clearance; exact for roles
        match = next((c for c in choices if c.upper() == value.upper()), None)
        if match:
            return match
        print(f"  ERROR: '{value}' is not valid. Choose one of: {choices_str}")


def prompt_multi(label: str, choices: list[str], default: list[str] | None = None) -> list[str]:
    """Prompt for zero or more values from a fixed list (comma-separated)."""
    choices_str = ", ".join(choices)
    default_str = ", ".join(default) if default else "none"
    display = f"{label} ({choices_str}) [default: {default_str}]: "

    while True:
        raw = input(display).strip()
        if not raw:
            result = default if default is not None else []
            if result:
                print(f"  -> Using default: {', '.join(result)}")
            else:
                print("  -> Using default: none")
            return result

        parts = [p.strip().upper() for p in raw.replace(",", " ").split()]
        invalid = [p for p in parts if p not in [c.upper() for c in choices]]
        if invalid:
            print(f"  ERROR: Invalid value(s): {', '.join(invalid)}. Choose from: {choices_str}")
            continue
        # Return in the canonical case from choices
        upper_map = {c.upper(): c for c in choices}
        return [upper_map[p] for p in parts]


def validate_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))


def validate_username(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9\-_]{0,62}", value))


def validate_nationality(value: str) -> bool:
    return value.upper() in ISO3166_ALPHA3


# ---------------------------------------------------------------------------
# YAML builder
# ---------------------------------------------------------------------------

CLEARANCE_DSP_MAP = {
    "TS": ("topsecret, secret, confidential, unclassified", "hierarchy"),
    "S":  ("secret, confidential, unclassified",            "hierarchy"),
    "C":  ("confidential, unclassified",                    "hierarchy"),
    "U":  ("unclassified",                                  "hierarchy"),
}

COALITION_MAP = {
    "USA": ["usa", "fvey", "nato", "pink"],
    "GBR": ["gbr", "fvey", "nato", "pink"],
    "AUS": ["aus", "fvey", "nato", "pink"],
    "CAN": ["can", "fvey", "nato", "pink"],
    "NZL": ["nzl", "fvey", "nato", "pink"],
    "FRA": ["fra", "nato", "pink"],
    "DEU": ["deu", "nato", "pink"],
}

def entitlements_comment(clearance: str, ntk: list[str], nationality: str) -> str:
    """Build the entitlement comment block that matches the existing YAML style."""
    cls_vals, cls_rule = CLEARANCE_DSP_MAP.get(clearance, ("unclassified", "hierarchy"))
    ntk_vals = ", ".join(v.lower() for v in ntk) if ntk else "< none >"
    coalitions = COALITION_MAP.get(nationality.upper(), [nationality.lower()])
    relto_vals = ", ".join(coalitions)

    lines = [
        "#  With Keycloak idP attributes below, the user below is entitled through Subject Mappings/Subject Condition Sets to DSP policy Attribute Values:",
        "# | Attribute Definition FQN              | Entitled To Forms/Data of Values" + " " * (max(0, 50 - len(cls_vals))) + "| Attribute Rule Type            |",
        "# |---------------------------------------|---------------------------------------------------|--------------------------------|",
        f"# | https://demo.com/attr/needtoknow      | {ntk_vals:<50}| all_of                         |",
        f"# | https://demo.com/attr/classification  | {cls_vals:<50}| hierarchy                      |",
        f"# | https://demo.com/attr/relto           | {relto_vals:<50}| any_of                         |",
    ]
    return "\n      ".join(lines)


def build_yaml_block(user: dict) -> str:
    """Render the YAML user entry (6-space indent to match the file)."""
    clearance = user["clearance"]
    ntk = user["needToKnow"]
    nationality = user["nationality"]
    is_admin = user["realmRole"] == "opentdf-org-admin"

    comment = entitlements_comment(clearance, ntk, nationality)

    ntk_lines = ""
    if ntk:
        ntk_lines = "          needToKnow:\n" + "".join(f"            - {v}\n" for v in ntk)
    else:
        ntk_lines = "          needToKnow: []\n"

    groups_block = ""
    if user.get("groups"):
        groups_block = "        groups:\n" + "".join(f"          - {g}\n" for g in user["groups"])

    client_roles_block = ""
    if is_admin:
        client_roles_block = textwrap.dedent("""\
                clientRoles:
                  realm-management:
                    - view-clients
                    - query-clients
                    - view-users
                    - query-users
                  tdf-entity-resolution:
                    - entity-resolution-test-role
        """)

    block = f"""\
      {comment}
      - username: {user['username']}
        enabled: true
        firstName: {user['firstName']}
        lastName: {user['lastName']}
        email: {user['email']}
        credentials:
          - value: {user['password']}
            type: password
        attributes:
          nationality:
            - {nationality.upper()}
{ntk_lines}\
          clearance:
            - {clearance}
{groups_block}\
        realmRoles:
          - {user['realmRole']}
{client_roles_block}"""
    return block


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Add a new Keycloak user to sample.keycloak.yaml")
    print("=" * 60)
    print()

    # --- username ---
    while True:
        username = prompt("Username (lowercase, hyphens/underscores allowed)")
        if validate_username(username):
            break
        print("  ERROR: Username must be lowercase alphanumeric, hyphens, or underscores (max 63 chars).")

    # --- first / last name ---
    first_name = prompt("First name")
    last_name = prompt("Last name")

    # --- email ---
    while True:
        email = prompt("Email address")
        if validate_email(email):
            break
        print("  ERROR: Enter a valid email address (e.g. user@example.com).")

    # --- password ---
    password = prompt("Password", default="testuser123")

    print()
    print("-- Security Attributes --")
    print("These IdP attributes drive DSP policy entitlements via subject condition sets.")
    print()

    # --- clearance ---
    clearance_choices = list(VALID_CLEARANCES.keys())
    descriptions = " | ".join(f"{k}={v}" for k, v in VALID_CLEARANCES.items())
    print(f"  Clearance levels: {descriptions}")
    clearance = prompt_choice("Clearance", clearance_choices, default="U")

    # --- needToKnow ---
    print()
    ntk = prompt_multi(
        "Need-to-Know compartments (space or comma separated, or leave blank for none)",
        VALID_NEED_TO_KNOW,
        default=[],
    )

    # --- nationality ---
    print()
    while True:
        nationality = prompt("Nationality (ISO 3166-1 alpha-3, e.g. USA, GBR, FRA)")
        if validate_nationality(nationality):
            nationality = nationality.upper()
            break
        print(f"  ERROR: '{nationality}' is not a recognised ISO 3166-1 alpha-3 code.")

    print()
    print("-- Keycloak Role --")
    print("  opentdf-org-admin : full admin (also grants realm-management client roles)")
    print("  opentdf-admin     : platform admin")
    print("  opentdf-standard  : regular user (default)")
    print()
    realm_role = prompt_choice("Realm role", VALID_REALM_ROLES, default="opentdf-standard")

    # --- optional group ---
    print()
    add_group = input("Add user to 'mygroup'? (y/N) [default: N]: ").strip().lower()
    groups = ["mygroup"] if add_group == "y" else []

    # --- summary ---
    print()
    print("=" * 60)
    print("  Summary")
    print("=" * 60)
    print(f"  username    : {username}")
    print(f"  name        : {first_name} {last_name}")
    print(f"  email       : {email}")
    print(f"  password    : {password}")
    print(f"  clearance   : {clearance} ({VALID_CLEARANCES[clearance]})")
    print(f"  needToKnow  : {', '.join(ntk) if ntk else '(none)'}")
    print(f"  nationality : {nationality}")
    print(f"  realm role  : {realm_role}")
    print(f"  groups      : {', '.join(groups) if groups else '(none)'}")
    print()

    confirm = input("Append this user to sample.keycloak.yaml? (Y/n) [default: Y]: ").strip().lower()
    if confirm == "n":
        print("Aborted. No changes made.")
        sys.exit(0)

    user = {
        "username": username,
        "firstName": first_name,
        "lastName": last_name,
        "email": email,
        "password": password,
        "clearance": clearance,
        "needToKnow": ntk,
        "nationality": nationality,
        "realmRole": realm_role,
        "groups": groups,
    }

    yaml_block = build_yaml_block(user)

    # Insert the new user block just before the `    token_exchanges:` line
    with open(KEYCLOAK_YAML, "r") as f:
        content = f.read()

    marker = "    token_exchanges:"
    if marker not in content:
        # Fallback: append at end of file
        with open(KEYCLOAK_YAML, "a") as f:
            f.write("\n" + yaml_block)
    else:
        updated = content.replace(marker, yaml_block + marker)
        with open(KEYCLOAK_YAML, "w") as f:
            f.write(updated)

    print()
    print(f"User '{username}' added to {KEYCLOAK_YAML}.")
    print()
    print("Next steps:")
    print("  Re-run Keycloak provisioning to create the user:")
    print("    docker compose run --rm dsp-keycloak-provisioning")
    print()
    print("Generated YAML block:")
    print("-" * 60)
    print(yaml_block)


if __name__ == "__main__":
    main()
