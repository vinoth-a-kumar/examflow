#!/bin/bash
set -e

echo "=========================================================="
echo " Starting ExamFlow All-in-One Linux Production Container  "
echo "=========================================================="

# Ensure MariaDB runtime and data directories exist
mkdir -p /var/run/mysqld /var/lib/mysql
chown -R mysql:mysql /var/run/mysqld /var/lib/mysql
chmod 777 /var/run/mysqld

# Initialize MariaDB data directory if empty (e.g. freshly mounted volume)
if [ ! -d "/var/lib/mysql/mysql" ]; then
    echo "==> [MariaDB] Initializing new database storage in /var/lib/mysql..."
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql > /dev/null 2>&1 || mysql_install_db --user=mysql --datadir=/var/lib/mysql > /dev/null 2>&1
    chown -R mysql:mysql /var/lib/mysql
    echo "==> [MariaDB] Initialization completed."
fi

# Start MariaDB service in the background
echo "==> [MariaDB] Starting database engine..."
mysqld_safe --skip-syslog --skip-name-resolve > /dev/null 2>&1 &
MYSQL_PID=$!

# Wait for MariaDB to become ready
echo "==> [MariaDB] Waiting for database socket connection..."
for i in $(seq 1 30); do
    if mysqladmin ping --silent > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! mysqladmin ping --silent > /dev/null 2>&1; then
    echo "==> [ERROR] MariaDB failed to start within 30 seconds."
    exit 1
fi

echo "==> [MariaDB] Database engine active and listening on port 3306."

# Ensure database and user permissions are established
DB_TARGET="${DB_NAME:-examflow}"
echo "==> [MariaDB] Verifying database '$DB_TARGET'..."
mariadb -e "CREATE DATABASE IF NOT EXISTS \`${DB_TARGET}\`;" 2>/dev/null || mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_TARGET}\`;" 2>/dev/null || true
mariadb -e "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '';" 2>/dev/null || mysql -e "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '';" 2>/dev/null || true
mariadb -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" 2>/dev/null || mysql -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" 2>/dev/null || true
mariadb -e "CREATE USER IF NOT EXISTS 'root'@'localhost' IDENTIFIED BY '';" 2>/dev/null || mysql -e "CREATE USER IF NOT EXISTS 'root'@'localhost' IDENTIFIED BY '';" 2>/dev/null || true
mariadb -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost' WITH GRANT OPTION;" 2>/dev/null || mysql -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost' WITH GRANT OPTION;" 2>/dev/null || true
mariadb -e "CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '';" 2>/dev/null || mysql -e "CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '';" 2>/dev/null || true
mariadb -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;" 2>/dev/null || mysql -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;" 2>/dev/null || true
mariadb -e "FLUSH PRIVILEGES;" 2>/dev/null || mysql -e "FLUSH PRIVILEGES;" 2>/dev/null || true

# Seed default examination accounts directly in MySQL if not present
mariadb -e "USE \`${DB_TARGET}\`;
CREATE TABLE IF NOT EXISTS users (
  \`_id\` VARCHAR(255) PRIMARY KEY,
  \`username\` VARCHAR(255) UNIQUE NOT NULL,
  \`email\` VARCHAR(255) UNIQUE NOT NULL,
  \`password\` VARCHAR(255) NOT NULL,
  \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO users (\`_id\`, \`username\`, \`email\`, \`password\`, \`createdAt\`) VALUES
('user_rrc_admin_01', 'rrc_exam_admin', 'rrc_exam_admin@rrc.edu', '3916d589fc29ac0b320bcd2054cea9d480dc33d305e01502e90d2835950af962', NOW()),
('user_rrc_internal_02', 'rrc_exam_internal', 'rrc_exam_internal@rrc.edu', 'c5a3223c0c020c4d09e92e053303333e81f36362ebfae6b80077efb5ac402b86', NOW()),
('user_rrc_external_03', 'rrc_exam_external', 'rrc_exam_external@rrc.edu', '0f2f6704951c7dcb5606b3b93fd4cb7a127bd1a3d20f40146759418275ea4e38', NOW());
" 2>/dev/null || true

# Prepare application data persistence folder
mkdir -p /app/backend/data/backups

# Graceful termination handler
cleanup() {
    echo ""
    echo "==> [ExamFlow] Shutdown signal received. Stopping services gracefully..."
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID" 2>/dev/null || true
        wait "$NODE_PID" 2>/dev/null || true
    fi
    mysqladmin shutdown 2>/dev/null || kill -TERM "$MYSQL_PID" 2>/dev/null || true
    echo "==> [ExamFlow] Container stopped cleanly."
    exit 0
}
trap cleanup SIGTERM SIGINT

# Launch Node.js Backend Application
APP_PORT="${PORT:-5001}"
echo "==> [ExamFlow] Launching ExamFlow on port ${APP_PORT}..."
PORT=${APP_PORT} node backend/server.js &
NODE_PID=$!

# Wait on background processes
wait "$NODE_PID"
