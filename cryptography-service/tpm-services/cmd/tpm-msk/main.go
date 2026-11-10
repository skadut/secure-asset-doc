// Command tpm-msk manages a TPM-bound master key (MSK) and wraps or unwraps DEKs with it.
package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/term"

	"tpm-msk/internal/audit"
	"tpm-msk/internal/envelope"
	"tpm-msk/internal/kek"
	"tpm-msk/internal/pki"
	"tpm-msk/internal/tpm"
)

const usage = `Usage: tpm-msk <command> [flags]

Commands:
  init      Create or import the TPM-bound MSK
  backup    Export or import a portable key-zone escrow bundle (backup export|import)
  wrap      Encrypt a DEK into an envelope
  unwrap    Decrypt a DEK from an envelope
  selftest  Check TPM capabilities
  info      Show TPM properties and key-file status
  kek       Create or list KEKs (kek create|list)
  audit     Verify an audit log chain (audit verify)
  pki       Generate the dev PKI
  serve     Run the mTLS KEK delivery service (prompts for PIN)

Run "tpm-msk <command> -h" for command flags.
`

const (
	maxInput    = 1024 // max DEK and max imported key text, bytes
	maxEnvelope = 16 << 10
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "--help", "-h", "help":
		fmt.Fprint(stdout, usage)
		return 0
	case "init":
		return cmdInit(args[1:], stdout, stderr)
	case "backup":
		return cmdBackup(args[1:], stdout, stderr)
	case "wrap":
		return cmdWrap(args[1:], stdout, stderr)
	case "unwrap":
		return cmdUnwrap(args[1:], stdout, stderr)
	case "selftest":
		return cmdSelftest(args[1:], stdout, stderr)
	case "info":
		return cmdInfo(args[1:], stdout, stderr)
	case "kek":
		if len(args) > 1 {
			switch args[1] {
			case "create":
				return cmdKEKCreate(args[2:], stdout, stderr)
			case "list":
				return cmdKEKList(args[2:], stdout, stderr)
			}
		}
	case "audit":
		if len(args) > 1 && args[1] == "verify" {
			return cmdAuditVerify(args[2:], stdout, stderr)
		}
	case "pki":
		return cmdPKI(args[1:], stdout, stderr)
	case "serve":
		return cmdServe(args[1:], stdout, stderr)
	}
	fmt.Fprint(stderr, usage)
	return 2
}

func newFlags(name, summary string, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet("tpm-msk "+name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprintf(stderr, "Usage: tpm-msk %s [flags]\n%s\n\nFlags:\n", name, summary)
		fs.PrintDefaults()
	}
	return fs
}

// parse returns (exit code, true) on success; otherwise the exit code to return.
func parse(fs *flag.FlagSet, args []string) (int, bool) {
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0, false
		}
		return 2, false
	}
	if fs.NArg() != 0 {
		fmt.Fprintln(fs.Output(), "unexpected arguments")
		return 2, false
	}
	return 0, true
}

// resolveKey maps an empty --key to the default key file path.
func resolveKey(p string) (string, error) {
	if p != "" {
		return p, nil
	}
	return tpm.DefaultKeyPath()
}

func cmdInit(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("init", "Create or import the TPM-bound MSK.", stderr)
	key := fs.String("key", "", "key file path (default %APPDATA%\\tpm-msk\\msk.key)")
	force := fs.Bool("force", false, "overwrite existing key file")
	useImport := fs.Bool("import", false, "import MSK from stdin as hex (32-64 bytes)")
	escrowDir := fs.String("escrow", "", "write recoverable MSK escrow shares to this directory")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *useImport && *escrowDir != "" {
		fmt.Fprintln(stderr, "--import and --escrow are mutually exclusive")
		return 2
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	if err := tpm.CheckAbsent(keyPath, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	dir := filepath.Dir(keyPath)
	_, statErr := os.Stat(dir)
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		fmt.Fprintln(stderr, statErr)
		return 1
	}
	if errors.Is(statErr, os.ErrNotExist) {
		if err := os.MkdirAll(dir, 0700); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := tpm.RestrictToCurrentUser(dir, true); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	// Escrow file is checked before any TPM key is created, so a refusal leaves no new key behind.
	escrowFile := ""
	if *escrowDir != "" {
		escrowFile = filepath.Join(*escrowDir, "msk.escrow")
		if err := tpm.CheckAbsent(escrowFile, false); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if _, err := os.Stat(*escrowDir); errors.Is(err, os.ErrNotExist) {
			if err := os.MkdirAll(*escrowDir, 0700); err != nil {
				fmt.Fprintln(stderr, err)
				return 1
			}
			if err := tpm.RestrictToCurrentUser(*escrowDir, true); err != nil {
				fmt.Fprintln(stderr, err)
				return 1
			}
		} else if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	var imp []byte
	if *useImport {
		b, err := io.ReadAll(io.LimitReader(os.Stdin, maxInput+1))
		defer zero(b)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if len(b) > maxInput {
			fmt.Fprintln(stderr, "import input exceeds 1024 bytes")
			return 1
		}
		imp = bytes.TrimSpace(b)
		if err := checkImportHex(imp); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}

	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	confirm, err := readPIN(stderr, "Confirm PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	same := subtle.ConstantTimeCompare(pin, confirm) == 1
	zero(confirm)
	if !same {
		fmt.Fprintln(stderr, "PINs do not match")
		return 1
	}

	if escrowFile != "" {
		return initEscrow(keyPath, escrowFile, pin, *force, stdout, stderr)
	}

	// tpm.Init zeroes pin and imp.
	if err := tpm.Init(keyPath, pin, imp, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stdout, keyPath)
	if !*useImport {
		fmt.Fprintln(stderr, "generated MSK cannot be exported or backed up; losing this TPM or key file loses all wrapped DEKs")
	}
	return 0
}

func cmdWrap(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("wrap", "Encrypt a DEK (max 1024 bytes) into an envelope.", stderr)
	key := fs.String("key", "", "key file path (default %APPDATA%\\tpm-msk\\msk.key)")
	label := fs.String("label", "", "envelope label (required)")
	in := fs.String("in", "", "file holding the DEK (required)")
	out := fs.String("out", "", "output envelope file (required)")
	force := fs.Bool("force", false, "overwrite output if it exists")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *label == "" || *in == "" || *out == "" {
		fmt.Fprintln(stderr, "wrap requires --label, --in, and --out")
		return 2
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := tpm.CheckAbsent(*out, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	dek, err := readLimited(*in, maxInput)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(dek)
	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	h, err := tpm.Open(keyPath, pin)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer h.Close()
	env, err := envelope.Wrap(h, *label, dek)
	zero(dek)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := tpm.WriteAtomic(*out, env, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "wrote %s\n", *out)
	return 0
}

func cmdUnwrap(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("unwrap", "Decrypt a DEK from an envelope.", stderr)
	key := fs.String("key", "", "key file path (default %APPDATA%\\tpm-msk\\msk.key)")
	in := fs.String("in", "", "envelope file (required)")
	out := fs.String("out", "", "output DEK file (required)")
	force := fs.Bool("force", false, "overwrite output if it exists")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *in == "" || *out == "" {
		fmt.Fprintln(stderr, "unwrap requires --in and --out")
		return 2
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := tpm.CheckAbsent(*out, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	env, err := readLimited(*in, maxEnvelope)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	h, err := tpm.Open(keyPath, pin)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer h.Close()
	dek, _, err := envelope.Unwrap(h, env)
	if err != nil {
		if errors.Is(err, envelope.ErrUnwrap) {
			fmt.Fprintln(stderr, "unwrap failed")
		} else {
			fmt.Fprintln(stderr, err)
		}
		return 1
	}
	defer zero(dek)
	if err := tpm.WriteAtomic(*out, dek, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "wrote %s\n", *out)
	return 0
}

func cmdSelftest(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("selftest", "Check TPM capabilities. No PIN required.", stderr)
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if err := tpm.Selftest(stdout); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func cmdInfo(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("info", "Show TPM properties and key-file status. No PIN required.", stderr)
	key := fs.String("key", "", "key file path (default %APPDATA%\\tpm-msk\\msk.key)")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "keyPath: %s\n", keyPath)
	exists := "no"
	if tpm.KeyFileExists(keyPath) {
		exists = "yes"
	}
	fmt.Fprintf(stdout, "keyFile: %s\n", exists)
	if err := tpm.Info(stdout); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func cmdKEKCreate(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("kek create", "Create a KEK using the TPM-bound MSK.", stderr)
	id := fs.String("id", "", "KEK ID (required)")
	file := fs.String("file", "", "KEK file path (default platform config path)")
	key := fs.String("key", "", "key file path (default %APPDATA%\\tpm-msk\\msk.key)")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *id == "" {
		fmt.Fprintln(stderr, "kek create requires --id")
		return 2
	}
	keksPath := *file
	if keksPath == "" {
		var err error
		keksPath, err = kek.DefaultPath()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	keyPath, err := resolveKey(*key)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	pin, err := readPIN(stderr, "PIN: ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer zero(pin)
	h, err := tpm.Open(keyPath, pin)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer h.Close()
	version, err := kek.Create(keksPath, h, *id)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "created %s version %d\n", *id, version)
	return 0
}

func cmdKEKList(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("kek list", "List KEK IDs and metadata. No PIN required.", stderr)
	file := fs.String("file", "", "KEK file path (default platform config path)")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	keksPath := *file
	if keksPath == "" {
		var err error
		keksPath, err = kek.DefaultPath()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	entries, err := kek.List(keksPath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	for _, e := range entries {
		fmt.Fprintf(stdout, "%s %d %s\n", e.KEKID, e.Version, e.Created)
	}
	return 0
}

func cmdPKI(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("pki", "Generate the development PKI. No PIN required.", stderr)
	out := fs.String("out", "", "output directory (required)")
	force := fs.Bool("force", false, "overwrite existing files")
	if code, ok := parse(fs, args); !ok {
		return code
	}
	if *out == "" {
		fmt.Fprintln(stderr, "pki requires --out")
		return 2
	}
	if err := pki.Generate(*out, *force); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stdout, *out)
	return 0
}

func cmdAuditVerify(args []string, stdout, stderr io.Writer) int {
	fs := newFlags("audit verify <file>", "Verify an audit log hash chain. No PIN required.", stderr)
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(stderr, "audit verify requires exactly one file")
		return 2
	}
	f, err := os.Open(fs.Arg(0))
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	defer f.Close()
	count, badLine, err := audit.Verify(f)
	if err != nil {
		if badLine > 0 {
			fmt.Fprintf(stderr, "broken at line %d: %v\n", badLine, err)
		} else {
			fmt.Fprintln(stderr, err)
		}
		return 1
	}
	fmt.Fprintf(stdout, "OK (%d records)\n", count)
	return 0
}

// checkImportHex validates trimmed hex text decodes to 32-64 bytes. Decoded bytes are zeroed.
func checkImportHex(h []byte) error {
	buf := make([]byte, hex.DecodedLen(len(h)))
	defer zero(buf)
	n, err := hex.Decode(buf, h)
	if err != nil {
		return errors.New("invalid import hex")
	}
	if n < 32 || n > 64 {
		return errors.New("imported key must be 32-64 bytes")
	}
	return nil
}

// readPIN prompts on stderr and reads a PIN without echo. Uses CONIN$ when stdin is not a terminal.
func readPIN(stderr io.Writer, prompt string) ([]byte, error) {
	fmt.Fprint(stderr, prompt)
	var pin []byte
	var err error
	if term.IsTerminal(int(os.Stdin.Fd())) {
		pin, err = term.ReadPassword(int(os.Stdin.Fd()))
	} else {
		var f *os.File
		if f, err = os.OpenFile("CONIN$", os.O_RDWR, 0); err == nil {
			pin, err = term.ReadPassword(int(f.Fd()))
			_ = f.Close()
		}
	}
	fmt.Fprintln(stderr)
	if err != nil {
		zero(pin)
		return nil, fmt.Errorf("cannot read PIN from console: %w", err)
	}
	if len(pin) < 6 {
		zero(pin)
		return nil, errors.New("PIN must be at least 6 bytes")
	}
	return pin, nil
}

// readLimited reads at most max bytes from path and rejects larger files.
func readLimited(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		zero(b)
		return nil, err
	}
	if int64(len(b)) > max {
		zero(b)
		return nil, fmt.Errorf("%s exceeds %d bytes", path, max)
	}
	return b, nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
