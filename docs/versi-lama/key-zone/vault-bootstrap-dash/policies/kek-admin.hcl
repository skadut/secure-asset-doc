path "transit/keys/crypto-module-kek"         { capabilities = ["read", "update"] }
path "transit/keys/crypto-module-kek/rotate" { capabilities = ["update"] }
path "transit/keys/crypto-module-kek/config" { capabilities = ["update"] }
path "transit/keys/crypto-module-kek/trim"   { capabilities = ["update"] }
path "sys/audit"                             { capabilities = ["read"] }
path "sys/storage/raft/configuration"        { capabilities = ["read"] }
