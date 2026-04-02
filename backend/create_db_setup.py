import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
import getpass
import sys

def create_database():
    print("--- Eval System V2 Database Setup ---")
    print("This script will create the 'eval_admin' user and 'eval_system' database.")
    print("Please enter the password for your local 'postgres' superuser.")
    
    pg_password = getpass.getpass("Enter password for user 'postgres': ")
    
    if not pg_password:
        print("Error: Password cannot be empty.")
        return

    try:
        # Connect to default 'postgres' db to perform admin tasks
        con = psycopg2.connect(
            dbname='postgres', 
            user='postgres', 
            host='localhost', 
            password=pg_password
        )
        con.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = con.cursor()
        
        # 1. Create User
        print("Checking/Creating user 'eval_admin'...")
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname='eval_admin'")
        if not cur.fetchone():
            # Create user
            cur.execute("CREATE USER eval_admin WITH PASSWORD 'secure_pass';")
            # Grant Create DB privileges just in case
            cur.execute("ALTER USER eval_admin CREATEDB;")
            print("User 'eval_admin' created.")
        else:
            print("User 'eval_admin' already exists.")

        # 2. Create Database
        print("Checking/Creating database 'eval_system'...")
        cur.execute("SELECT 1 FROM pg_database WHERE datname='eval_system'")
        if not cur.fetchone():
            cur.execute("CREATE DATABASE eval_system OWNER eval_admin;")
            print("Database 'eval_system' created.")
        else:
            print("Database 'eval_system' already exists.")

        cur.close()
        con.close()
        print("\nSUCCESS: Database setup complete!")
        print("You can now run 'pipenv run alembic upgrade head'")

    except psycopg2.OperationalError as e:
        print(f"\nCONNECTION ERROR: Could not connect to PostgreSQL @ localhost.")
        print(f"Details: {e}")
        print("Please check if PostgreSQL service is running and password is correct.")
    except Exception as e:
        print(f"\nERROR: {e}")

if __name__ == "__main__":
    create_database()
