# Code signing the Windows installer

An **unsigned** Windows installer triggers SmartScreen warnings ("Windows protected your PC" / "Unknown publisher") and can be blocked by policy. Signing the app fixes this.

## What you need

1. **A code signing certificate** from a trusted Certificate Authority (CA), for example:
   - **Standard OV (Organization Validation)**  
     DigiCert, Sectigo, SSL.com, etc. — typically £100–400/year.  
     You’ll get a PFX/P12 file and a password after identity verification.
   - **EV (Extended Validation)**  
     Same CAs, higher cost; often uses a hardware token.  
     Builds gain SmartScreen reputation faster (fewer “Unknown publisher” warnings once the cert is known).

2. **The certificate file** (`.pfx` or `.p12`) and its **password** on the machine where you run `npm run build` or `npm run release`.

## Enabling signing in the build

The build is set up to sign when certificate environment variables are present. No code change is required.

### Option A: Local build (your PC)

1. Put your `.pfx` file somewhere safe (e.g. a folder not in the repo), e.g.  
   `C:\certs\custody-note.pfx`

2. Set environment variables **before** running the build:

   **PowerShell:**

   ```powershell
   $env:CSC_LINK = "C:\certs\custody-note.pfx"
   $env:CSC_KEY_PASSWORD = "YourCertificatePassword"
   npm run build
   ```

   **Command Prompt:**

   ```cmd
   set CSC_LINK=C:\certs\custody-note.pfx
   set CSC_KEY_PASSWORD=YourCertificatePassword
   npm run build
   ```

   For a full release (build + publish to GitHub):

   ```powershell
   $env:CSC_LINK = "C:\certs\custody-note.pfx"
   $env:CSC_KEY_PASSWORD = "YourCertificatePassword"
   npm run release patch
   ```

3. **Security:** Do not commit the `.pfx` or the password to git. Add `*.pfx` and `.env.local` to `.gitignore` if you store the path/password there.

### Option B: CI (GitHub Actions, etc.)

- Store the certificate as a **secret** (e.g. base64-encoded PFX in `CSC_LINK`, password in `CSC_KEY_PASSWORD`).
- In the workflow, set `CSC_LINK` and `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` for Windows-only) before running `npm run build` or your release script.

Example (conceptual):

```yaml
env:
  CSC_LINK: ${{ secrets.WIN_CODE_SIGNING_PFX_BASE64 }}
  CSC_KEY_PASSWORD: ${{ secrets.WIN_CODE_SIGNING_PASSWORD }}
run: npm run build
```

(Encode the PFX: `base64 -w0 custody-note.pfx` or PowerShell equivalent, then put that string in the secret.)

### Option C: Build on macOS/Linux for Windows

Use the Windows-specific variables so only the Windows build uses the Windows cert:

```bash
export WIN_CSC_LINK="/path/to/custody-note.pfx"
export WIN_CSC_KEY_PASSWORD="YourCertificatePassword"
npm run release patch
```

## Verifying the signed installer

After building:

1. Right-click the built `.exe` (e.g. in `custody-note-dist\`) → **Properties** → **Digital Signatures**.
2. The certificate and publisher name should appear. SmartScreen may still show “Unknown publisher” for a new cert until enough users install it (faster with an EV cert).

## If you don’t have a certificate yet

- **Users:** They can still run the app by choosing “More info” → “Run anyway” on the SmartScreen dialog. Not ideal for a professional product.
- **You:** Obtain a certificate from one of the CAs above, then set `CSC_LINK` and `CSC_KEY_PASSWORD` as above so every build is signed.

## Summary

| Step | Action |
|------|--------|
| 1 | Obtain a code signing certificate (PFX) from a CA. |
| 2 | Set `CSC_LINK` (path or base64 of PFX) and `CSC_KEY_PASSWORD` before building. |
| 3 | Run `npm run build` or `npm run release`; the installer and executable will be signed. |
| 4 | Do not commit the PFX or password to the repo. |
