FROM amazonlinux:2023

# Set working directory
WORKDIR /app

# Install system dependencies
RUN dnf update -y && \
    dnf install -y --allowerasing \
    curl \
    tar \
    gzip \
    unzip \
    # Install Node.js 22 from Nodesource
    && curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - \
    && dnf install -y nodejs \
    # Install AWS CLI v2
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    # Install Session Manager Plugin
    && curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm" -o "session-manager-plugin.rpm" \
    && dnf install -y session-manager-plugin.rpm \
    # Clean up
    && dnf clean all \
    && rm -rf awscliv2.zip aws session-manager-plugin.rpm

# Copy package.json and install Node.js dependencies
COPY package.json ./
RUN npm install

# Copy server.mjs
COPY server.mjs ./

# Expose WebSocket port
EXPOSE 8080

# Command to run the WebSocket server
CMD ["node", "server.mjs"]
