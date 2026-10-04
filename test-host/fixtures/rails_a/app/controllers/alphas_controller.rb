class AlphasController < ApplicationController
  def index
    @alphas = Alphas.all
  end
end
