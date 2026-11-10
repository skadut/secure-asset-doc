# 3-node Key Zone Vault config (vault-1, vault-2, vault-3). Satu file untuk semua node.
# Per-node env from root compose: VAULT_RAFT_NODE_ID, VAULT_API_ADDR, VAULT_CLUSTER_ADDR.
# Mounts per node: /vault/tls/node (dir cert node itu sendiri), /vault/tls/admin (ca, cert, key untuk retry_join).

ui = false

# ponytail: mlock disabled. Vault's mlock needs IPC_LOCK, which the doc allows but this
# sim drops (cap_drop ALL). Swap is compensated instead: memswap_limit == mem_limit
# (no swap in the container) and host swap is off. Sized at 512m; doc minimum is 4 GB/node,
# so raise mem_limit for real use. Upgrade path: drop disable_mlock, add cap IPC_LOCK.
disable_mlock = true

storage "raft" {
  path = "/vault/file"

  retry_join {
    leader_api_addr         = "https://vault-1:8200"
    leader_ca_cert_file     = "/vault/tls/node/ca.pem"
    leader_client_cert_file = "/vault/tls/admin/cert.pem"
    leader_client_key_file  = "/vault/tls/admin/key.pem"
  }

  retry_join {
    leader_api_addr         = "https://vault-2:8200"
    leader_ca_cert_file     = "/vault/tls/node/ca.pem"
    leader_client_cert_file = "/vault/tls/admin/cert.pem"
    leader_client_key_file  = "/vault/tls/admin/key.pem"
  }

  retry_join {
    leader_api_addr         = "https://vault-3:8200"
    leader_ca_cert_file     = "/vault/tls/node/ca.pem"
    leader_client_cert_file = "/vault/tls/admin/cert.pem"
    leader_client_key_file  = "/vault/tls/admin/key.pem"
  }
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"

  tls_cert_file                      = "/vault/tls/node/cert.pem"
  tls_key_file                       = "/vault/tls/node/key.pem"
  tls_client_ca_file                 = "/vault/tls/node/ca.pem"
  tls_min_version                    = "tls12"
  tls_require_and_verify_client_cert = true
}
