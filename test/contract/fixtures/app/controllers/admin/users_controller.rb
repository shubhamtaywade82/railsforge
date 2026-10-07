module Admin
  class UsersController < BaseController
    before_action :require_admin

    def index; end

    def destroy; end

    private def require_admin; end
  end
end
